/**
 * scoreboard-clock.ts — pure clock math for the scoreboard.
 *
 * No React: every function is a pure transform so the timer behaviour can be
 * unit-tested without rendering. `scoreboardClockMs` is the single source of
 * truth for the big numeral — it counts DOWN from the phase time limit in
 * countdown mode and UP (elapsed) otherwise.
 */
import type { MatchFormatConfig } from '@myclash/types';
import type { ClockEvent } from '@myclash/ui';

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

export type PhaseType = 'pool' | 'single_elim' | 'double_elim' | 'swiss';

export function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((clamped % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(
    centiseconds,
  ).padStart(2, '0')}`;
}

export function isMedalMatchLabel(label: string | null | undefined) {
  const normalized = (label ?? '').trim().toUpperCase();
  return ['F', 'FINAL', 'GOLD', 'GOLD MEDAL MATCH', '3RD', 'BRONZE', 'BRONZE MEDAL MATCH'].includes(
    normalized,
  );
}

export function phaseTimeLimitSeconds(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
) {
  if (phaseType === 'pool') return matchFormat.timeLimitsSeconds.pool;
  if (isMedalMatchLabel(matchNumberLabel)) return matchFormat.timeLimitsSeconds.finals;
  return matchFormat.timeLimitsSeconds.bracket;
}

/** Convert raw elapsed active ms into the value to display: countdown subtracts
 *  from the phase limit (clamped at 0); count-up returns elapsed unchanged. */
export function displayClockMs(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
) {
  const limitSeconds = phaseTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (matchFormat.timerMode === 'countdown' && limitSeconds !== null) {
    return Math.max(0, limitSeconds * 1000 - elapsedMs);
  }
  return elapsedMs;
}

export function shouldWarnClock(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
) {
  const limitSeconds = phaseTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return false;
  return Math.max(0, limitSeconds * 1000 - elapsedMs) < 10_000;
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
