/**
 * bout-flow.ts — the cumulative score of a bout, event by event.
 *
 * Turns the same exchange + penalty rows the unified timeline renders into a
 * step series: after every event, what did the scoreboard read? That is the
 * whole feature — the timeline says WHAT happened, this says HOW THE LEAD MOVED.
 *
 * The hard requirement is that the LAST point equals the score the surface
 * prints beside the chart. Summing `red_score_delta`/`blue_score_delta` does NOT
 * give that in three shipped configurations, so this module CALLS the engine's
 * transform — `applyScoringDirection` — rather than summing the raw deltas:
 *
 *   - `reverse_zero_loses` scores DOWN from the point cap (a side hitting 0
 *     loses), so the running total is `pointCap − opponentEarned`.
 *   - A pool bout that reaches the double cap is a DOUBLE LOSS: both scores are
 *     zero, not the points earned.
 *   - In a best-of match `matches.red_score` holds the OPEN round only.
 *
 * The order of operations (earn → direction → penalties) is `recomputeMatchScore`'s.
 * The direction step used to be a hand-written copy of `computeMatchFormatScore`'s
 * two lines, which is what `@myclash/rules` exists to stop; it is now the same
 * function both call.
 *
 * Pure: no React, no I/O. Numbering is delegated to `ascendingWithNumbers` so
 * the chart's x-axis and the timeline's `#N` are the same number by
 * construction.
 */

import { applyScoringDirection, type MatchFormatConfig } from '@myclash/types';
import { ascendingWithNumbers } from './exchange-timeline';
import { foldPauses, type BoutFlowPause } from './bout-flow-clock';
import type { ClockEvent, ExchangeRow, Penalty, PenaltyCard } from '../types/match-events';

export type { BoutFlowPause } from './bout-flow-clock';

/** One event's worth of the running score. */
export interface BoutFlowPoint {
  /** Shared timeline number — the `#N` the EVENTS list shows. 0 is the origin. */
  number: number;
  /** Match-clock position (accumulated ACTIVE ms). Null on pre-0095 rows. */
  elapsedMs: number | null;
  /** Score after this event. Always what the scoreboard would read. */
  red: number;
  blue: number;
  kind: 'exchange' | 'penalty' | 'origin';
  /** Side the event belongs to — the scorer, or the carded fighter. */
  side: 'red' | 'blue' | null;
  card: PenaltyCard | null;
  isDouble: boolean;
}

export interface BoutFlowSeries {
  points: BoutFlowPoint[];
  /**
   * Resolved, not requested: 'time' needs a clock reading on every event and at
   * least two distinct ones. Rows predating migration 0095 have no
   * `clock_time_ms` at all, so this degrades instead of drawing them at x=0.
   */
  xAxis: 'time' | 'index';
  pauses: BoutFlowPause[];
  /** Times the lead changed hands (ties are not a change, regaining is). */
  leadChanges: number;
  /** Longest unbroken run of points by one side. */
  longestRun: { side: 'red' | 'blue'; points: number } | null;
  doubles: number;
  /** The double cap for this phase, when one applies. Drives the doubles chip. */
  maxDoubles: number | null;
  /** True when the bout ended 0–0 on the double cap. */
  doubleLoss: boolean;
  /** The score that ends the bout — drawn as the chart's ceiling. */
  pointCap: number;
  /** True when the bout scores DOWN from the cap, so the ceiling is the floor. */
  reverse: boolean;
}

/** A `match_events` clock row, as `GET /matches/:id/clock` returns them. */
export type BoutFlowClockEvent = ClockEvent;

export interface BuildBoutFlowArgs {
  exchanges: ExchangeRow[];
  penalties: Penalty[];
  redRegId: string;
  blueRegId: string;
  matchFormat: MatchFormatConfig;
  /** `matches.end_reason` — 'max_doubles' is the double loss. */
  endReason?: string | null;
  /** Best-of state. Filtering only kicks in when `bestOf > 1`. */
  bestOf?: number;
  currentRound?: number;
  /** Omit to draw no pause markers (surfaces without the clock endpoint). */
  clockEvents?: BoutFlowClockEvent[];
}

/** Sortable shape `ascendingWithNumbers` needs, plus what we score from. */
interface FlowDraft {
  occurredAt: string;
  seq: number;
  kind: 'exchange' | 'penalty';
  elapsedMs: number | null;
  /** Points EARNED this event, before the direction transform. */
  redEarned: number;
  blueEarned: number;
  /** Penalty adjustment, applied AFTER the direction transform. */
  redPenalty: number;
  bluePenalty: number;
  side: 'red' | 'blue' | null;
  card: PenaltyCard | null;
  isDouble: boolean;
}

/**
 * Per-side earnings for one exchange.
 *
 * `scoreDelta`/`defenderDelta` arrive already netted for the tournament's
 * afterblow mode (the API nets them at write time and again when listing), so
 * there is deliberately NO afterblow arithmetic here — doing it a second time
 * would double-deduct. Doubles and no-exchanges earn nothing, exactly as
 * `computeDeltas` and `computeMatchFormatScore` agree they do.
 */
function exchangeEarnings(e: ExchangeRow): { red: number; blue: number } {
  if (e.type === 'double' || e.type === 'no_exchange') return { red: 0, blue: 0 };
  const striker = e.scoringSide;
  if (!striker) return { red: 0, blue: 0 };
  const strikerPts = e.scoreDelta ?? 0;
  const defenderPts = e.defenderDelta ?? 0;
  return striker === 'red'
    ? { red: strikerPts, blue: defenderPts }
    : { red: defenderPts, blue: strikerPts };
}

function exchangeDrafts(exchanges: ExchangeRow[], inRound: (r?: number | null) => boolean) {
  return exchanges
    .filter((e) => !e.voided && inRound(e.round_number))
    .map((e): FlowDraft => {
      const earned = exchangeEarnings(e);
      return {
        occurredAt: e.occurredAt,
        seq: e.sequence,
        kind: 'exchange',
        elapsedMs: e.clockTimeMs ?? null,
        redEarned: earned.red,
        blueEarned: earned.blue,
        redPenalty: 0,
        bluePenalty: 0,
        side: e.scoringSide ?? null,
        card: null,
        isDouble: e.type === 'double',
      };
    });
}

/**
 * Cards carry no round_number: a card belongs to the bout, and the server adds
 * every non-voided card's delta to the score whatever round it landed in.
 */
function penaltyDrafts(
  penalties: Penalty[],
  redRegId: string,
  blueRegId: string,
  inRound: (round?: number | null) => boolean,
) {
  return penalties
    .filter((p) => !p.voided && inRound(p.round_number))
    .map((p): FlowDraft => {
      const side: 'red' | 'blue' | null =
        p.registration_id === redRegId ? 'red' : p.registration_id === blueRegId ? 'blue' : null;
      const delta = p.score_delta ?? 0;
      return {
        occurredAt: p.occurred_at ?? '',
        seq: p.sequence,
        kind: 'penalty',
        elapsedMs: p.clock_time_ms ?? null,
        redEarned: 0,
        blueEarned: 0,
        redPenalty: side === 'red' ? delta : 0,
        bluePenalty: side === 'blue' ? delta : 0,
        side,
        card: p.card,
        isDouble: false,
      };
    });
}

/** Run the drafts up into scores, applying the direction on the way. */
function accumulate(
  ordered: (FlowDraft & { number: number })[],
  matchFormat: Pick<MatchFormatConfig, 'pointCap' | 'scoringDirection'>,
): { points: BoutFlowPoint[]; doubles: number } {
  const reverse = matchFormat.scoringDirection === 'reverse_zero_loses';
  const points: BoutFlowPoint[] = [
    {
      number: 0,
      elapsedMs: 0,
      red: reverse ? matchFormat.pointCap : 0,
      blue: reverse ? matchFormat.pointCap : 0,
      kind: 'origin',
      side: null,
      card: null,
      isDouble: false,
    },
  ];
  let redEarned = 0;
  let blueEarned = 0;
  let redPenalty = 0;
  let bluePenalty = 0;
  let doubles = 0;

  for (const row of ordered) {
    redEarned += row.redEarned;
    blueEarned += row.blueEarned;
    redPenalty += row.redPenalty;
    bluePenalty += row.bluePenalty;
    if (row.isDouble) doubles += 1;
    // Direction first, penalties after — the order `recomputeMatchScore` uses.
    const directed = applyScoringDirection(matchFormat, redEarned, blueEarned);
    points.push({
      number: row.number,
      elapsedMs: row.elapsedMs,
      red: directed.redScore + redPenalty,
      blue: directed.blueScore + bluePenalty,
      kind: row.kind,
      side: row.side,
      card: row.card,
      isDouble: row.isDouble,
    });
  }
  return { points, doubles };
}

/** Lead changes + the longest single-side scoring run, from the finished series. */
function summarise(points: BoutFlowPoint[]): Pick<BoutFlowSeries, 'leadChanges' | 'longestRun'> {
  let leadChanges = 0;
  let leader: 'red' | 'blue' | null = null;
  let bestSide: 'red' | 'blue' | null = null;
  let bestRun = 0;
  let runSide: 'red' | 'blue' | null = null;
  let run = 0;

  points.forEach((p, i) => {
    // A tie holds the previous leader rather than clearing it: levelling the
    // score is not yet a change of lead, taking it back in front is.
    const next = p.red > p.blue ? 'red' : p.blue > p.red ? 'blue' : leader;
    if (next && leader && next !== leader) leadChanges += 1;
    leader = next;
    if (i === 0) return;

    const prev = points[i - 1]!;
    const redGain = p.red - prev.red;
    const blueGain = p.blue - prev.blue;
    if (redGain > 0 && blueGain > 0) {
      // Both scored (a full afterblow) — nobody's run survives that.
      run = 0;
      runSide = null;
      return;
    }
    const gainer = redGain > 0 ? 'red' : blueGain > 0 ? 'blue' : null;
    if (!gainer) return;
    run =
      gainer === runSide
        ? run + (gainer === 'red' ? redGain : blueGain)
        : gainer === 'red'
          ? redGain
          : blueGain;
    runSide = gainer;
    if (run > bestRun) {
      bestRun = run;
      bestSide = gainer;
    }
  });

  return {
    leadChanges,
    longestRun: bestSide && bestRun > 0 ? { side: bestSide, points: bestRun } : null,
  };
}

/**
 * 'time' needs a clock reading on every event and more than one distinct value
 * — a bout scored with the clock stopped would otherwise stack at x=0.
 */
function resolveAxis(points: BoutFlowPoint[]): 'time' | 'index' {
  const scored = points.filter((p) => p.kind !== 'origin');
  const timed =
    scored.length > 0 &&
    scored.every((p) => p.elapsedMs !== null) &&
    new Set(scored.map((p) => p.elapsedMs)).size > 1;
  return timed ? 'time' : 'index';
}

export function buildBoutFlow({
  exchanges,
  penalties,
  redRegId,
  blueRegId,
  matchFormat,
  endReason,
  bestOf = 1,
  currentRound = 1,
  clockEvents,
}: BuildBoutFlowArgs): BoutFlowSeries {
  const reverse = matchFormat.scoringDirection === 'reverse_zero_loses';
  const cap = matchFormat.pointCap;
  const doubleLoss = endReason === 'max_doubles';
  // Best-of: only the open round, matching the server's own filter. A single
  // round match keeps every row, `round_number` unread.
  //
  // Penalties go through the SAME filter since migration 0191 gave them a round.
  // They used not to, so a best-of chart re-applied every card from every round
  // to the open round and drifted from the score beside it.
  const inRound = (round?: number | null) => bestOf <= 1 || (round ?? 1) === currentRound;

  const ordered = ascendingWithNumbers([
    ...exchangeDrafts(exchanges, inRound),
    ...penaltyDrafts(penalties, redRegId, blueRegId, inRound),
  ]);
  const { points, doubles } = accumulate(ordered, matchFormat);

  // The double cap zeroes BOTH fighters. The cap is always reached on the last
  // double, which closes the match, so it is the final point that drops.
  const last = points[points.length - 1];
  if (doubleLoss && last && last.kind !== 'origin') {
    last.red = 0;
    last.blue = 0;
  }

  const maxDoubles = matchFormat.maxDoubleHits;
  return {
    points,
    xAxis: resolveAxis(points),
    pauses: clockEvents ? foldPauses(clockEvents) : [],
    ...summarise(points),
    doubles,
    maxDoubles: maxDoubles === null || maxDoubles <= 0 ? null : maxDoubles,
    doubleLoss,
    pointCap: cap,
    reverse,
  };
}
