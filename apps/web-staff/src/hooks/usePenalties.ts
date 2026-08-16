'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PenaltyCard, Penalty as MatchPenalty } from '@myclash/ui';
import type { ExistingPenaltyForSanction } from '@myclash/types';
import { resolveEntryCard } from '../offline/resolve-entry-card';
import { fetchWithCache } from '../offline/cached-reads';

// The card union and the `match_penalties` wire row are declared once in
// @myclash/ui (packages/ui/src/types/match-events.ts) because the shared
// timeline builder and the TV display need them too. Re-exported here so this
// hook stays the import site every consumer already uses. `export type` is
// required — isolatedModules is on.
export type { PenaltyCard, MatchPenalty };

export interface PenaltyRulesetEntry {
  id: string;
  group_number: number;
  ref_number: number;
  short_name: string;
  description: string;
  /** Card colours this entry triggers (subset of the ruleset's card set). */
  sanctions: PenaltyCard[];
}

export interface PenaltyRuleset {
  id: string;
  name: string;
  /**
   * Where prior offences are counted from: 'match' or across the tournament.
   * On the wire since the endpoint was written — `getRuleset` selects `*` — and
   * dropped by this type until the pad needed to resolve a card itself.
   */
  accumulation_scope?: string | null;
  /** Per-card point cost. Same story: always sent, never declared. */
  yellow_card_points?: number | null;
  red_card_points?: number | null;
  black_card_points?: number | null;
  penalty_ruleset_entries?: PenaltyRulesetEntry[];
}

/** Prior cards the two fighters are accumulating against, from the API. */
interface PenaltyScope {
  accumulationScope: string;
  priors: Record<string, ExistingPenaltyForSanction[]>;
}

interface UsePenaltiesResult {
  ruleset: PenaltyRuleset | null;
  penalties: MatchPenalty[];
  /** Non-voided penalties only — what the operator typically wants. */
  active: MatchPenalty[];
  /** Set of card colours the ruleset uses (derived from entry sanctions). */
  ruleSetCards: PenaltyCard[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * Filter helper: count of active penalties for a registration matching
   * the given card colour. Used by the per-side card counter chips.
   */
  countFor: (registrationId: string, card: PenaltyCard) => number;
  /**
   * Which card this entry will ACTUALLY produce for this fighter, counting the
   * offences they already have in the same rule group.
   *
   * The picker used to show `entry.sanctions[0]` — always the FIRST-occurrence
   * card. On a fighter's second offence in a group the button said yellow and
   * the server issued red. Wrong online as much as offline.
   *
   * Same function the server calls, on the same input the server gathers, so
   * the two cannot reach different answers by reasoning differently.
   */
  resolveCard: (entry: PenaltyRulesetEntry, registrationId: string) => PenaltyCard | undefined;
}

const ALL_CARDS: PenaltyCard[] = ['yellow', 'red', 'black'];

/**
 * Centralised penalty + ruleset fetch. Used by:
 *   - the per-side penalty picker (ruleset entries)
 *   - the per-side card-counter chips under the club name
 *   - the centre column's unified events list (rendered alongside
 *     exchanges)
 *
 * Two fetches resolved in parallel: `/penalty-ruleset` and
 * `/penalties`. Re-runs when `refreshKey` is bumped (after each
 * applied or voided penalty).
 */
export function usePenalties(
  apiUrl: string,
  matchId: string | null | undefined,
  refreshKey: number,
): UsePenaltiesResult {
  const [ruleset, setRuleset] = useState<PenaltyRuleset | null>(null);
  const [scope, setScope] = useState<PenaltyScope | null>(null);
  const [penalties, setPenalties] = useState<MatchPenalty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      // The catalogue is SETUP data — which entries exist and what card each
      // one carries — so it is cached on the tablet. Without it an offline pad
      // shows an empty penalty picker and no referee can card anyone. The
      // penalties themselves are live match state and are never cached; a stale
      // card list is the kind of thing the service worker's no-stale rule
      // exists to prevent.
      fetchWithCache<PenaltyRuleset | null>(apiUrl, `/api/v1/matches/${matchId}/penalty-ruleset`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      // Prior offences in the ruleset's accumulation scope. Cached for the same
      // reason the catalogue is: at tournament scope these live in OTHER
      // matches, so an offline pad cannot re-derive them and would silently
      // under-count the occurrence — showing yellow where the server issues red.
      fetchWithCache<PenaltyScope>(apiUrl, `/api/v1/matches/${matchId}/penalty-scope`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([rulesetResult, penaltiesRes, scopeResult]) => {
        if (rulesetResult) {
          setRuleset(rulesetResult.body);
        }
        if (penaltiesRes.ok) {
          setPenalties((await penaltiesRes.json()) as MatchPenalty[]);
        }
        if (scopeResult) {
          setScope(scopeResult.body);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() kicks off the fetch (sets loading); intentional on mount/refresh.
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const active = penalties.filter((p) => !p.voided);

  // Derive the set of card colours actually used by this ruleset's
  // entries. Falls back to the full {yellow, red, black} set if the
  // ruleset doesn't enumerate any entries with sanctions.
  const ruleSetCards = (() => {
    const seen = new Set<PenaltyCard>();
    for (const entry of ruleset?.penalty_ruleset_entries ?? []) {
      for (const card of entry.sanctions) seen.add(card);
    }
    if (seen.size === 0) return ALL_CARDS;
    return ALL_CARDS.filter((c) => seen.has(c));
  })();

  const countFor = (registrationId: string, card: PenaltyCard) =>
    active.filter((p) => p.registration_id === registrationId && p.card === card).length;

  const resolveCard = (entry: PenaltyRulesetEntry, registrationId: string) =>
    resolveEntryCard(entry, registrationId, scope?.priors[registrationId]);

  return {
    ruleset,
    penalties,
    active,
    ruleSetCards,
    loading,
    error,
    refresh,
    countFor,
    resolveCard,
  };
}
