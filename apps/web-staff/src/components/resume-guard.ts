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
import { effectiveTimeLimitSeconds, type PhaseType } from './scoreboard-clock';

/**
 * `inSuddenDeath` is REQUIRED, not an optional trailing flag.
 *
 * Sudden death runs with the countdown sitting at 00:00 by design — that is
 * what the state IS — so every single resume would meet this challenge, on the
 * one surface where the referee is restarting the clock most often. An optional
 * parameter would have let the one caller keep the old behaviour silently.
 */
export function resumeBlockedByRuleset(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
  elapsedMs: number,
  inSuddenDeath: boolean,
): boolean {
  if (inSuddenDeath) return false;
  if (matchFormat.timerMode !== 'countdown') return false;
  const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return false;
  const remainingMs = Math.max(0, limitSeconds * 1000 - elapsedMs);
  return remainingMs <= matchFormat.softClockLimitSeconds * 1000;
}
