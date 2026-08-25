/**
 * scoreboard-clock.ts — the pad's clock STATE math.
 *
 * No React: every function is a pure transform so the timer behaviour can be
 * unit-tested without rendering. This module owns what is specific to the pad —
 * the persisted clock state and how much of it has actually run
 * ({@link elapsedActiveMs}, {@link clockShouldTick}).
 *
 * How that elapsed time READS on a scoreboard — the phase time limit, countdown
 * vs count-up, `MM:SS:CC` — belongs to `@myclash/types` (match-clock.ts), which
 * the projector and the admin preview render from too. Those helpers used to be
 * duplicated here, and the copy had drifted: it billed a Swiss bout at the
 * BRACKET limit while the engine that ends the bout uses `swiss ?? pool`, so the
 * pad could run a Swiss match against a clock nobody would honour. Re-exported
 * below so this module stays the pad's single import.
 */
import {
  displayClockMs,
  timeIsFinished,
  type LevelStep,
  type MatchFormatConfig,
  type PhaseType,
} from '@myclash/types';
import type { ClockEvent } from '@myclash/ui';

export {
  displayClockMs,
  effectiveTimeLimitSeconds,
  formatClockMs,
  shouldWarnClock,
  timeIsFinished,
  type PhaseType,
} from '@myclash/types';

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

export interface ClockState {
  matchId: string;
  status: ClockStatus;
  activeMs: number;
  runningFrom: string | null;
  totalActiveMs: number;
  startedAt: string | null;
  /**
   * The transitions the totals were folded from — always returned by
   * `GET /matches/:id/clock`, this type just dropped them. The end-of-bout flow
   * chart replays them to place its stoppage markers: the totals say how much
   * time ran, never where it stopped.
   */
  events?: ClockEvent[];
  /**
   * How far down the phase's level-at-time chain this bout has been taken. The
   * pad reads it to NAME the remedy on its own button and to know when sudden
   * death is live; the server still decides whether the remedy applies.
   *
   * Optional because an older API answers without it, and `?? 0` is then the
   * start of the chain, which is what an un-resolved bout is.
   */
  levelResolutionSteps?: number;
}

/** Whether the UI's `now` ticker should run. Running is obvious; HALTED must
 *  tick too so the wall-clock TOTAL TIME keeps flowing while the match clock
 *  is paused (the big clock is unaffected — elapsedActiveMs returns the
 *  constant activeMs when not running). Idle/ended clocks are frozen. */
export function clockShouldTick(status: ClockStatus): boolean {
  return status === 'running' || status === 'halted';
}

/** Accumulated active ms: the persisted `activeMs` plus the wall time elapsed
 *  since `runningFrom` while the clock is running. `now` is injected for tests. */
export function elapsedActiveMs(state: ClockState | null, now: number): number {
  if (!state) return 0;
  if (state.status === 'running' && state.runningFrom) {
    return state.activeMs + (now - new Date(state.runningFrom).getTime());
  }
  return state.activeMs;
}

/**
 * How long SUDDEN DEATH has been running — the count-up under the skull.
 *
 * Time since the countdown reached zero, so it needs no state of its own: the
 * remedies before it have already moved `elapsedMs` (extra time is an
 * `adjust_time` row), which puts the zero exactly where the referee saw it.
 * Clamped at zero for the referee who declares sudden death with time still on
 * the board — it starts when the clock expires, not when the step was recorded.
 *
 * With no phase limit — a count-up tournament — there is no zero to count from,
 * so the elapsed time IS the answer.
 */
export function suddenDeathElapsedMs(elapsedMs: number, limitMs: number | null): number {
  if (limitMs === null) return Math.max(0, elapsedMs);
  return Math.max(0, elapsedMs - limitMs);
}

/**
 * The remedy to OFFER on the button, or null for no button at all.
 *
 * The phase's chain says what a level bout plays; this says whether the referee
 * may play it yet. The server refuses both the End and the advance while the
 * bout still has time to run, so a button shown before then is one that answers
 * with a 400 — and a scorekeeper mid-event cannot debug a 400.
 *
 * A `draw` step is not a remedy: the referee simply ends the bout, which is what
 * a pool table's D column is for. It is filtered here rather than at the call
 * site so both facts about the button live in one place.
 *
 * `elapsedMs` is passed in rather than read off `state`, because the caller
 * holds the LIVE figure — a ticking `now` folded into the running interval —
 * and a bout that crosses its limit mid-exchange has to grow the button then,
 * not at the next refetch.
 */
export function remedyToOffer(
  pending: LevelStep | null,
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): LevelStep | null {
  if (pending === null || pending.kind === 'draw') return null;
  if (!timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel)) return null;
  return pending;
}

/** The number the big scoreboard clock shows for `state` at time `now`. */
export function scoreboardClockMs(
  state: ClockState | null,
  now: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): number {
  return displayClockMs(elapsedActiveMs(state, now), matchFormat, phaseType, matchNumberLabel);
}
