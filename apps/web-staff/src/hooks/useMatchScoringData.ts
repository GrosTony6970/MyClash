'use client';

/**
 * Everything the scoring pad knows about one match's events, read ONCE.
 *
 * WHY THIS EXISTS. `usePenalties` makes three requests and `useExchanges` one,
 * and both re-run whenever `refreshKey` bumps — which is every scored hit. Four
 * components were calling them: `ScoringColumn` twice (it renders once per
 * fighter), `ScoringCenterControls`, and `MatchCorrectionsDrawer`. The drawer
 * looks conditional and is not: `MatchView` mounts it unconditionally and its
 * `if (!open) return null` sits BELOW the hooks, so a shut drawer fetched
 * exactly as hard as an open one. Fourteen requests per hit, on hall wifi,
 * which is the network this app exists to survive.
 *
 * Now `MatchView` calls this once and hands the result down as one prop. Four
 * requests per hit.
 *
 * WHY A PROP AND NOT A CONTEXT. Every consumer is a DIRECT child of
 * `MatchView`, so there is no drilling depth for a context to remove — and a
 * prop makes `tsc` prove each one is wired rather than leaving it to a runtime
 * lookup. Prop count is unchanged either way: each child trades the
 * `refreshKey` it only used to feed these hooks for the result itself.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN. `MatchResultOverlay` and the corrections
 * drawer both need the SERVER lists, never the merged ones — a queued row in
 * `buildBoutFlow` would chart a hit that has not landed. Both lists are exposed
 * separately for that reason; the merge is the caller's decision, not this
 * hook's.
 */

import { useMemo } from 'react';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { TournamentScoringConfig } from '@myclash/types';
import { useExchanges } from './useExchanges';
import {
  usePenalties,
  type PenaltyCard,
  type PenaltyRuleset,
  type PenaltyRulesetEntry,
} from './usePenalties';
import { usePendingOutbox } from './usePendingOutbox';
import {
  cardCountFor,
  pendingRowsForMatch,
  provisionalDeltas,
  queuedCardsFor as queuedCardsForRegistration,
} from '../offline/pending-events';

export interface MatchScoringData {
  // ── What the server has ────────────────────────────────────────────────────
  ruleset: PenaltyRuleset | null;
  ruleSetCards: PenaltyCard[];
  /** Non-voided server rows. NOT merged with the queue — see the docblock. */
  activeExchanges: ExchangeRow[];
  activePenalties: Penalty[];

  // ── What the tablet is still holding ───────────────────────────────────────
  /** Queued rows the server has not acknowledged, deduped on `client_uuid`. */
  pendingExchanges: ExchangeRow[];
  pendingPenalties: Penalty[];
  /**
   * Queued cards the pad could not put a price on. Non-zero means the score
   * below is incomplete and a surface showing it must say so.
   */
  unpricedCards: number;
  /**
   * Queued cards against ONE fighter, split by whether the pad could price
   * them. Per-registration because the caption sits under a single fighter's
   * numeral — the count it replaced was the whole match's, so a card against
   * blue was announced under red's score too.
   */
  queuedCardsFor: (registrationId: string) => { priced: number; unpriced: number };
  /** Outbox rows for THIS match — what the clear-last-exchange button gates on. */
  pendingHere: number;
  /** What the queue adds to each side's score. Display only, never stored. */
  provisional: { red: number; blue: number };

  // ── Helpers ────────────────────────────────────────────────────────────────
  countFor: (registrationId: string, card: PenaltyCard) => number;
  resolveCard: (entry: PenaltyRulesetEntry, registrationId: string) => PenaltyCard | undefined;
  refreshExchanges: () => void;
}

export function useMatchScoringData(args: {
  apiUrl: string;
  matchId: string;
  refreshKey: number;
  config: TournamentScoringConfig;
  redRegistrationId: string;
  blueRegistrationId: string;
  /**
   * The SyncEngine's pending count, NOT a per-match one.
   *
   * This is the only trigger that notices a BACKGROUND drain. `refreshKey`
   * bumps on the referee's own actions; a reconnect empties the queue with no
   * mutation at all, and without this the provisional score and the queued
   * timeline rows would sit on screen after the server had already accepted
   * them. `ScoringCenterControls` used to derive its own count on
   * `[matchId, refreshKey]`, which collapses to `refreshKey` and cannot see a
   * drain — that copy is gone.
   */
  syncPendingCount: number;
}): MatchScoringData {
  const { apiUrl, matchId, refreshKey, config, redRegistrationId, blueRegistrationId } = args;

  const { active: activeExchanges, refresh: refreshExchanges } = useExchanges(
    apiUrl,
    matchId,
    refreshKey,
  );
  const {
    ruleset,
    priors,
    ruleSetCards,
    active: activePenalties,
    resolveCard,
  } = usePenalties(apiUrl, matchId, refreshKey);

  const pendingEntries = usePendingOutbox(matchId, refreshKey, args.syncPendingCount);

  const pending = useMemo(
    () =>
      pendingRowsForMatch({
        entries: pendingEntries,
        config,
        serverExchanges: activeExchanges,
        serverPenalties: activePenalties,
        // The catalogue and the prior offences the pad already holds — enough
        // to say what a queued card will cost. Null in either slot means it
        // cannot, and the count below says how many it could not.
        pricing: { ruleset, priors },
      }),
    [pendingEntries, config, activeExchanges, activePenalties, ruleset, priors],
  );

  const provisional = useMemo(
    () =>
      provisionalDeltas({
        exchanges: pending.exchanges,
        penalties: pending.penalties,
        redRegistrationId,
        blueRegistrationId,
      }),
    [pending, redRegistrationId, blueRegistrationId],
  );

  const countFor = (registrationId: string, card: PenaltyCard) =>
    cardCountFor({
      server: activePenalties,
      pending: pending.penalties,
      registrationId,
      card,
    });

  const queuedCardsFor = (registrationId: string) =>
    queuedCardsForRegistration({
      pending: pending.penalties,
      unpricedCardUuids: pending.unpricedCardUuids,
      registrationId,
    });

  return {
    ruleset,
    ruleSetCards,
    activeExchanges,
    activePenalties,
    pendingExchanges: pending.exchanges,
    pendingPenalties: pending.penalties,
    unpricedCards: pending.unpricedCardUuids.length,
    queuedCardsFor,
    pendingHere: pendingEntries.length,
    provisional,
    countFor,
    resolveCard,
    refreshExchanges,
  };
}
