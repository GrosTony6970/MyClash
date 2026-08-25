/**
 * Queued outbox rows, in the shape the shared timeline already renders.
 *
 * WHY. Every scoring surface on the pad reads through the server, and the
 * service worker resolves a synthetic 503 offline rather than falling back to a
 * cache — so `useExchanges` errors and keeps its last list frozen. Score three
 * hits in a dead hall and the timeline, the exchange count and the double count
 * all stand still. Nothing is lost, the outbox is durable, but the referee gets
 * no confirmation that the tablet heard them.
 *
 * `getPendingForMatch` has answered this since the outbox was written and has
 * never had a caller. This maps its rows onto `ExchangeRow` / `Penalty` so
 * `buildUnifiedTimeline` can merge them with the server's, numbered in one
 * sequence, which is the invariant that module exists to hold.
 *
 * SEED, DON'T RESOLVE. No SCORING ruleset is resolved here and
 * `@myclash/rulesets` is not reachable from this app. The arithmetic is
 * `computeAfterblowDeltas` for a hit and, via `./price-queued-cards`, the
 * penalty catalogue's own per-card columns for a card — both on the allowlist in
 * `ARCHITECTURE.md` §7.3, both the server's own functions, and neither of them
 * the engine.
 *
 * Pure: no Dexie, no React, no I/O. The caller supplies the rows.
 */
import {
  computeAfterblowDeltas,
  type PenaltyCard,
  type TournamentScoringConfig,
} from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { OutboxEntry } from './db';
import { createCardPricer, type PricedCard, type QueuedCardPricing } from './price-queued-cards';

/** Deltas an exchange contributes, on the pad's own reading of the config. */
function localDeltas(
  entry: OutboxEntry,
  config: TournamentScoringConfig,
): { scoreDelta: number | null; defenderDelta: number | null } {
  if (entry.type === 'clean') {
    return { scoreDelta: entry.firstStrikeValue ?? 0, defenderDelta: null };
  }
  if (entry.type === 'afterblow') {
    // The raw button values are what was queued — the server nets them under
    // the tournament's mode at read, which is precisely why offline scoring
    // works on a ruleset the pad never resolved. Netting them the same way here
    // is what makes the provisional row agree with what will land.
    const d = computeAfterblowDeltas(
      config.afterblowMode,
      entry.firstStrikeValue ?? 0,
      entry.afterblowValue ?? 0,
    );
    return { scoreDelta: d.attackerDelta, defenderDelta: d.defenderDelta };
  }
  // A double and a no-exchange score for nobody. `exchangeDeltaLabel` already
  // renders a null delta as no delta.
  return { scoreDelta: null, defenderDelta: null };
}

/**
 * One queued card as a timeline row.
 *
 * `priced` is null when the pad could not honestly say what the card is worth —
 * see `createCardPricer`. The row still renders, because a referee needs to see
 * that the tablet heard them, but it falls back to the yellow-shaped
 * placeholder this row carried before pricing existed: a shape, not a claim.
 */
function pendingPenaltyRow(entry: OutboxEntry, priced: PricedCard | null): Penalty {
  return {
    id: entry.clientUuid,
    // The outbox key, so the dedupe recognises this row once the server has it —
    // and so a merged timeline keys React on one value across the hand-over.
    client_uuid: entry.clientUuid,
    sequence: entry.sequence,
    registration_id: entry.registrationId ?? '',
    // The card this fighter will ACTUALLY get, counting the offences they
    // already have in the same rule group.
    card: priced?.card ?? entry.directCard ?? 'yellow',
    source: priced?.source ?? (entry.directCard ? 'direct' : 'ruleset'),
    group_number: priced?.groupNumber ?? null,
    short_name: entry.reason ?? null,
    reason: entry.reason ?? null,
    score_delta: priced?.scoreDelta ?? 0,
    // Stays false even for a black card. The server decides forfeit from the
    // ruleset's first/second black-card SCOPE settings, which are not on the
    // wire the pad reads, and a bout-ending claim is not something to guess at.
    // A queued black card shows its colour and its points, and says nothing
    // about ending the fight.
    causes_match_forfeit: false,
    voided: false,
    occurred_at: entry.occurredAt,
    clock_time_ms: entry.clockTimeMs ?? null,
    pending: true,
  };
}

/**
 * Queued rows for one match, as timeline rows, with anything the server already
 * knows about filtered out.
 *
 * THE DEDUPE IS NOT OPTIONAL. Between a successful POST and `markSynced`
 * committing, a row is on the server AND still in the outbox. Rendering both
 * shows the referee one hit twice and can make the double count read 2/4 when
 * it is 1/4 — a rule they act on. `client_uuid` is the server's own idempotency
 * key, so it is the one field that identifies the same hit on both sides.
 *
 * BOTH SIDES READ `client_uuid`, AND THE PENALTY SIDE USED TO READ `id`.
 * `match_penalties` carries both columns — `id` is `gen_random_uuid()`,
 * `client_uuid` is what the pad sent (migration 0016) — so they are never equal
 * and the card dedupe never once matched. It was invisible while a queued card
 * claimed no points: the cost was a duplicated timeline row for one drain-loop
 * tick. It stops being invisible the moment a card carries points, because the
 * same tick then double-counts the score.
 */
export function pendingRowsForMatch(args: {
  entries: readonly OutboxEntry[];
  config: TournamentScoringConfig;
  serverExchanges: readonly ExchangeRow[];
  serverPenalties: readonly Penalty[];
  /**
   * What the pad knows about the penalty catalogue. Omit it and every queued
   * card comes back unpriced, which is what this module did before it could
   * price one at all.
   */
  pricing?: QueuedCardPricing;
}): {
  exchanges: ExchangeRow[];
  penalties: Penalty[];
  /**
   * `client_uuid` of every queued card the pad could not price — the ids, not a
   * count, because a caller showing a caption under ONE fighter's numeral has
   * to know which rows are theirs. A match-wide total cannot be split back up.
   */
  unpricedCardUuids: string[];
} {
  const { entries, config, serverExchanges, serverPenalties } = args;
  const known = new Set<string>();
  for (const e of serverExchanges) if (e.client_uuid) known.add(e.client_uuid);
  for (const p of serverPenalties) if (p.client_uuid) known.add(p.client_uuid);

  // Built once per pass and driven in order: pricing a card is a fold over the
  // fighter's prior offences, not a lookup. Created even with no pricing input
  // so the refusal path is the same code either way.
  const pricer = createCardPricer(args.pricing ?? { ruleset: null, priors: null });

  const exchanges: ExchangeRow[] = [];
  const penalties: Penalty[] = [];
  const unpricedCardUuids: string[] = [];

  for (const entry of entries) {
    // Ahead of the pricer on purpose. A card in the window between a successful
    // POST and `markSynced` is in this queue AND in the priors the pricer was
    // built from; folding it in again would invent an occurrence and escalate
    // the next card in its group.
    if (known.has(entry.clientUuid)) continue;

    // Absent on rows written before v3, which were all exchanges.
    if ((entry.kind ?? 'exchange') === 'penalty') {
      const priced = pricer.price({
        registrationId: entry.registrationId ?? '',
        rulesetEntryId: entry.rulesetEntryId,
        directCard: entry.directCard,
      });
      if (!priced) unpricedCardUuids.push(entry.clientUuid);
      penalties.push(pendingPenaltyRow(entry, priced));
      continue;
    }

    const { scoreDelta, defenderDelta } = localDeltas(entry, config);
    exchanges.push({
      // The clientUuid IS the id the server will give this row, so the React
      // key does not jump when it drains.
      id: entry.clientUuid,
      client_uuid: entry.clientUuid,
      sequence: entry.sequence,
      type: entry.type ?? 'clean',
      voided: false,
      // REQUIRED by `orderedWithNumbers`: without it the newest touch sorts
      // to #1 and the whole merged list renumbers wrongly.
      occurredAt: entry.occurredAt,
      clockTimeMs: entry.clockTimeMs ?? null,
      scoringSide: entry.firstStrikerColor ?? null,
      scoreDelta,
      defenderDelta,
      no_exchange_reason: entry.noExchangeReason ?? null,
      pending: true,
    });
  }

  return { exchanges, penalties, unpricedCardUuids };
}

/**
 * A fighter's count of one card colour, server rows PLUS the queue.
 *
 * The chip under the club name read the server only, so offline it froze: the
 * referee issued the fighter's second yellow and the counter stayed at one.
 * That is the counter they look at before deciding whether the next offence in
 * the group escalates, which makes a frozen one worse than most stale numbers.
 *
 * `pending` must already be deduped against `server` — `pendingRowsForMatch`
 * does it — or a card in the drain window is counted twice.
 */
export function cardCountFor(args: {
  server: readonly Penalty[];
  pending: readonly Penalty[];
  registrationId: string;
  card: PenaltyCard;
}): number {
  const { server, pending, registrationId, card } = args;
  const mine = (p: Penalty) => !p.voided && p.registration_id === registrationId && p.card === card;
  return server.filter(mine).length + pending.filter(mine).length;
}

/**
 * Queued cards against ONE fighter, split by whether the pad could price them.
 *
 * Per registration because the caption sits under a single fighter's numeral.
 * The count this replaced was the whole match's, so a card against blue was
 * announced under red's score too.
 *
 * PRICED IS NOT "WORTH SOMETHING". A yellow and a black are both worth zero
 * under the built-in rulebook, and a card the pad fully accounted for belongs
 * in the "included" line however little it moved the number — that line is the
 * only thing telling the referee the tablet heard the commonest card there is.
 * Only a card the pad could not work out at all goes in the other line.
 */
export function queuedCardsFor(args: {
  pending: readonly Penalty[];
  unpricedCardUuids: readonly string[];
  registrationId: string;
}): { priced: number; unpriced: number } {
  const { pending, unpricedCardUuids, registrationId } = args;
  const unpriced = new Set(unpricedCardUuids);
  const mine = pending.filter((p) => p.registration_id === registrationId);
  const notPriced = mine.filter((p) => p.client_uuid && unpriced.has(p.client_uuid)).length;
  return { priced: mine.length - notPriced, unpriced: notPriced };
}

/**
 * What the whole queue adds to each side's score — hits and cards together.
 *
 * ONE OWNER. This used to take exchanges alone and its docblock explained that
 * a card contributed nothing because the pad could not price one. It can now,
 * so a caller that summed only the exchanges would present an incomplete number
 * as a whole one. Taking both lists is what makes that impossible to get wrong
 * by omission.
 *
 * A card's delta lands on the CARDED fighter's own side, negative in the usual
 * case — the same arithmetic `recomputeMatchScore` does server-side.
 *
 * No round filter here, and none needed: these are OUTBOX rows, recorded in the
 * round that is open right now. Advancing a round is a server call, so a pad
 * holding a queue cannot have moved past the round its queue belongs to. The
 * server does filter by round (migration 0191 gave a card a `round_number`, and
 * `recomputeBestOfRounds` scores only the open round's cards) — it has to,
 * because it holds every round's rows and this only ever holds one round's.
 *
 * An unpriced card carries `score_delta: 0` and so adds nothing here. That is
 * only honest if the caller shows the count `pendingRowsForMatch` returns
 * alongside it.
 */
export function provisionalDeltas(args: {
  exchanges: readonly ExchangeRow[];
  penalties: readonly Penalty[];
  redRegistrationId: string;
  blueRegistrationId: string;
}): { red: number; blue: number } {
  const { exchanges, penalties, redRegistrationId, blueRegistrationId } = args;
  let red = 0;
  let blue = 0;
  for (const row of exchanges) {
    const striker = row.scoringSide;
    if (!striker) continue;
    if (striker === 'red') {
      red += row.scoreDelta ?? 0;
      blue += row.defenderDelta ?? 0;
    } else {
      blue += row.scoreDelta ?? 0;
      red += row.defenderDelta ?? 0;
    }
  }
  for (const penalty of penalties) {
    if (penalty.voided) continue;
    if (penalty.registration_id === redRegistrationId) red += penalty.score_delta;
    if (penalty.registration_id === blueRegistrationId) blue += penalty.score_delta;
  }
  return { red, blue };
}
