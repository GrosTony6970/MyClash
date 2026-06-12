/**
 * Should starting/resuming the clock be challenged? Per the ruleset the
 * clock should not restart once the countdown has reached zero or sits
 * inside the soft-clock zone — but the operator stays in charge: the UI
 * shows a warning with "continue anyway" / "end match" rather than
 * blocking outright.
 *
 * Pure: no React, no I/O.
 */
import type { MatchFormatConfig } from '@myclash/types';
import { phaseTimeLimitSeconds, type PhaseType } from './scoreboard-clock';

export function resumeBlockedByRuleset(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
  elapsedMs: number,
): boolean {
  if (matchFormat.timerMode !== 'countdown') return false;
  const limitSeconds = phaseTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return false;
  const remainingMs = Math.max(0, limitSeconds * 1000 - elapsedMs);
  return remainingMs <= matchFormat.softClockLimitSeconds * 1000;
}
