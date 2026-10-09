/**
 * "End match" pressed while the bout is not over by its own rules: the pad asks
 * before it ends the clock (operator ruling, 2026-10-08).
 *
 * The button sits just under Pause. An official who means Pause and hits it
 * ends the bout, and Re-open needs the network: with the wifi down the bout
 * stays ended. A normal end is not slowed: once a fighter is at the cap, or the
 * time is reached, the press ends the bout at once.
 *
 * A phase with no time limit has no time to wait for (`timeIsFinished` answers
 * true there), so its End is never early.
 */
import { pointCapWinnerColor, type MatchFormatConfig } from '@myclash/types';
import { timeIsFinished, type PhaseType } from './scoreboard-clock';

export function endIsEarly(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
  elapsedMs: number,
  score: { redScore: number; blueScore: number },
): boolean {
  if (pointCapWinnerColor(score, matchFormat) !== null) return false;
  return !timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel);
}
