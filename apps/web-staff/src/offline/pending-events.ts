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
 * SEED, DON'T RESOLVE. No ruleset is resolved here and `@myclash/rulesets` is
 * not reachable from this app. The only arithmetic is `computeAfterblowDeltas`,
 * which `ScoringColumn` already calls to label its own buttons — turning that
 * same call into a timeline delta is a display change, not a new capability.
 *
 * Pure: no Dexie, no React, no I/O. The caller supplies the rows.
 */
import { computeAfterblowDeltas, type TournamentScoringConfig } from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import type { OutboxEntry } from './db';

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
}): { exchanges: ExchangeRow[]; penalties: Penalty[] } {
  const { entries, config, serverExchanges, serverPenalties } = args;
  const known = new Set<string>();
  for (const e of serverExchanges) if (e.client_uuid) known.add(e.client_uuid);
  for (const p of serverPenalties) if (p.client_uuid) known.add(p.client_uuid);

  const exchanges: ExchangeRow[] = [];
  const penalties: Penalty[] = [];

  for (const entry of entries) {
    if (known.has(entry.clientUuid)) continue;

    // Absent on rows written before v3, which were all exchanges.
    if ((entry.kind ?? 'exchange') === 'penalty') {
      penalties.push({
        id: entry.clientUuid,
        sequence: entry.sequence,
        registration_id: entry.registrationId ?? '',
        // The card a queued penalty will actually carry depends on how many
        // prior offences the fighter has in the same rule group, which is the
        // penalty ruleset's business. Until the pad reads that, a queued card
        // shows as a yellow-shaped placeholder rather than a claim.
        card: entry.directCard ?? 'yellow',
        source: entry.directCard ? 'direct' : 'ruleset',
        short_name: entry.reason ?? null,
        reason: entry.reason ?? null,
        // Zero, not a guess. `score_delta` is computed server-side from the
        // active ruleset's per-card columns, and the pad does not read those
        // yet. `exchangeDeltaLabel` renders a zero as no delta, so the row
        // shows the card and claims no points.
        score_delta: 0,
        causes_match_forfeit: false,
        voided: false,
        occurred_at: entry.occurredAt,
        clock_time_ms: entry.clockTimeMs ?? null,
        pending: true,
      });
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

  return { exchanges, penalties };
}

/**
 * What the queued exchanges add to each side's score.
 *
 * Exchanges only. A queued penalty contributes nothing here, because its
 * `score_delta` comes from the active penalty ruleset's per-card columns and
 * the pad does not read those yet — see `pendingRowsForMatch`. The caller is
 * expected to say so rather than present an incomplete number as a complete
 * one.
 */
export function provisionalDeltas(rows: readonly ExchangeRow[]): { red: number; blue: number } {
  let red = 0;
  let blue = 0;
  for (const row of rows) {
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
  return { red, blue };
}
