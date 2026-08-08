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
import { displayClockMs, type MatchFormatConfig, type PhaseType } from '@myclash/types';
import type { ClockEvent } from '@myclash/ui';

export {
  displayClockMs,
  effectiveTimeLimitSeconds,
  formatClockMs,
  isMedalMatchLabel,
  shouldWarnClock,
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
