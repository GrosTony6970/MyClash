/**
 * scoreboard-clock.ts — pure clock math for the scoreboard.
 *
 * No React: every function is a pure transform so the timer behaviour can be
 * unit-tested without rendering. `scoreboardClockMs` is the single source of
 * truth for the big numeral — it counts DOWN from the phase time limit in
 * countdown mode and UP (elapsed) otherwise.
 */
import type { MatchFormatConfig } from '@myclash/types';

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

export interface ClockState {
  matchId: string;
  status: ClockStatus;
  activeMs: number;
  runningFrom: string | null;
  totalActiveMs: number;
  startedAt: string | null;
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
