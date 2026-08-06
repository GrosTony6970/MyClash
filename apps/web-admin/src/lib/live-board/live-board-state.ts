import { dueForSec, idleForSec, runningOverSec } from './live-board-timing';
import type { BoardRow } from './types';

export type HealthState =
  | 'attention'
  | 'no_scorer'
  | 'idle_stalled'
  | 'late'
  | 'stuck'
  | 'stale'
  | 'unknown'
  | 'synced'
  | 'idle';

export interface Thresholds {
  staleAgeSec: number;
  stuckAgeSec: number;
  /** A free piste with bouts waiting is a stall, not idleness, past this. */
  idleStalledSec: number;
  /** How overdue a not-yet-started bout may be before the piste reads late. */
  lateStartSec: number;
  /** Grace on top of the planned bout length before an overrun reads late. */
  overrunGraceSec: number;
}

/**
 * Minute-granular on purpose: a transition happens at most once per bout, so
 * rows do not visibly reshuffle under `worst`-first sorting at 1 Hz.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  staleAgeSec: 60,
  stuckAgeSec: 300,
  idleStalledSec: 300,
  lateStartSec: 600,
  overrunGraceSec: 300,
};

/** Everything `deriveHealthState` needs. */
export interface HealthInputs {
  row: BoardRow;
  /** From the shared seconds clock, so a simulated event reads correctly. */
  nowMs: number;
  /** The programme block's planned bout length. */
  matchDurationMinutes: number;
  thresholds?: Thresholds;
}

/**
 * Collapse a row's scorer/health/attention/timing into a single rollup for the
 * left dot. Ordering encodes precedence: an explicit attention flag outranks
 * any sync state, and a null health block is UNKNOWN (grey), never "synced" — a
 * false green is the one failure that defeats the board.
 *
 * `no_scorer` stays second, ahead of the timing states: an unmanned piste is
 * the reason the other signals are missing, so reporting anything else first
 * would describe the symptom instead of the cause. It nonetheless sorts LAST
 * (see SEVERITY) — a setup gap is not a live failure. Derivation order and
 * severity order are different questions and are answered separately.
 */
export function deriveHealthState({
  row,
  nowMs,
  matchDurationMinutes,
  thresholds = DEFAULT_THRESHOLDS,
}: HealthInputs): HealthState {
  if (row.attention) return 'attention';
  if (!row.scorer) return 'no_scorer';

  if (!row.currentMatch) {
    const idleFor = idleForSec(row, nowMs);
    // A free piste with bouts waiting on it is a stall; a free piste with an
    // empty queue is just done for now.
    if (row.queue.length > 0 && idleFor !== null && idleFor > thresholds.idleStalledSec) {
      return 'idle_stalled';
    }
    return 'idle';
  }

  if (isLate(row, nowMs, matchDurationMinutes, thresholds)) return 'late';
  if (row.health === null) return 'unknown';

  const h = row.health;
  if (h.rejectedCount > 0 || h.oldestPendingAgeSec > thresholds.stuckAgeSec) return 'stuck';
  if (h.outboxDepth > 0 && h.oldestPendingAgeSec > thresholds.staleAgeSec) return 'stale';
  return 'synced';
}

/** Overdue to start, or running well past its planned slot. */
function isLate(
  row: BoardRow,
  nowMs: number,
  matchDurationMinutes: number,
  thresholds: Thresholds,
): boolean {
  const due = dueForSec(row, nowMs);
  if (due !== null && due > thresholds.lateStartSec) return true;
  const over = runningOverSec(row, nowMs, matchDurationMinutes);
  return over !== null && over > thresholds.overrunGraceSec;
}

/**
 * Dot colour per state. A total `Record<HealthState, …>`: widening the union
 * fails to compile until every new member has a colour, and that compile error
 * is the checklist. Never add an index signature, a `Partial`, or a
 * `DOT[state] ?? …` fallback — each turns a compile-time checklist into a
 * runtime grey dot on the one screen whose job is not lying about health.
 *
 * `idle_stalled` is danger, not warning: a free piste with a queue is the most
 * expensive failure at an event. `late` is warning — it is running, just behind.
 */
export const DOT: Record<HealthState, string> = {
  attention: 'bg-danger',
  stuck: 'bg-danger',
  idle_stalled: 'bg-danger',
  late: 'bg-warning',
  stale: 'bg-warning',
  synced: 'bg-success',
  idle: 'bg-muted',
  unknown: 'bg-muted',
  no_scorer: 'bg-foreground',
};

// worst-first severity (lower = more urgent). no_scorer sits low: a setup gap,
// not a live failure. This is the SORT order, not the derivation order above.
const SEVERITY: Record<HealthState, number> = {
  attention: 0,
  stuck: 1,
  idle_stalled: 2,
  late: 3,
  stale: 4,
  unknown: 5,
  synced: 6,
  idle: 7,
  no_scorer: 8,
};

/** A piste nobody needs to look at. One owner — the row dim rule reads it too. */
export function isHealthy(state: HealthState): boolean {
  return state === 'synced' || state === 'idle';
}

/**
 * `stateOf` is required, not defaulted. A default that reached for `Date.now()`
 * itself would silently disagree with the clock the rows are rendered against —
 * and would re-derive per row per sort comparison. Callers memoise one state
 * per row per tick and pass a lookup in.
 */
export function sortBoardRows(
  rows: BoardRow[],
  mode: 'piste' | 'worst',
  stateOf: (row: BoardRow) => HealthState,
): BoardRow[] {
  const copy = rows.slice();
  if (mode === 'piste') {
    return copy.sort(
      (a, b) => a.lice.sortOrder - b.lice.sortOrder || a.lice.name.localeCompare(b.lice.name),
    );
  }
  return copy.sort((a, b) => {
    const d = SEVERITY[stateOf(a)] - SEVERITY[stateOf(b)];
    return d !== 0 ? d : a.lice.sortOrder - b.lice.sortOrder;
  });
}

/** Split rows into problems (anything not fully fine) and healthy (synced/idle). */
export function partitionByHealth(
  rows: BoardRow[],
  stateOf: (row: BoardRow) => HealthState,
): { problems: BoardRow[]; healthy: BoardRow[] } {
  const problems: BoardRow[] = [];
  const healthy: BoardRow[] = [];
  for (const row of rows) {
    (isHealthy(stateOf(row)) ? healthy : problems).push(row);
  }
  return { problems, healthy };
}
