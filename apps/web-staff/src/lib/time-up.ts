/**
 * "Time is up": did a running clock just cross its limit? (quick win P13;
 * operator, 2026-10-12).
 *
 * The tablet beeps and vibrates each time a RUNNING clock crosses 0:00:
 * regulation, extra time (the step puts time back on the clock, so the limit
 * is crossed again), each round of a best-of bout. Never when the screen opens
 * on a bout already past its time: with no reading before this one, nothing
 * was crossed here.
 *
 * Pure, out of the component: the pad has no React test setup. `timeIsFinished`
 * cannot answer this. It says "is the clock past its limit", which is true for
 * as long as the bout stays there, and true of a bout with no limit at all.
 */
export interface ClockReading {
  status: 'idle' | 'running' | 'halted' | 'ended';
  /** The active time of the bout's clock, in ms. */
  elapsedMs: number;
}

/**
 * `before` is the reading of the draw before this one, null at the first. The
 * clock crossed its limit when it RAN below the limit then, and is at or past
 * it now. A clock moved past its limit while it stands still (a time
 * correction) crossed nothing: nobody was fighting.
 */
export function crossedLimit(
  before: ClockReading | null,
  elapsedMs: number,
  limitMs: number | null,
): boolean {
  if (limitMs === null || before === null) return false;
  if (before.status !== 'running') return false;
  return before.elapsedMs < limitMs && elapsedMs >= limitMs;
}
