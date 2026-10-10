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
import {
  pendingLevelStep,
  pointCapWinnerColor,
  type LevelStep,
  type MatchFormatConfig,
} from '@myclash/types';
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

/** Why the pad does not end a bout: the server's two refusals of an End (`time-limit-result.ts`). */
export type EndRefusedOnPad =
  { reason: 'time_not_finished' } | { reason: 'level'; step: LevelStep | null };

/**
 * May "End match" be taken on the tablet? (Operator ruling 11: the pad checks
 * the rules it knows, then shows the bout as ended and not confirmed.)
 *
 * The End no longer waits for the server, so the two refusals the server gives
 * a LEVEL bout are given here first, by the same shared functions: with time
 * left there is nothing to decide, and at its time the phase's chain says what
 * to play, unless it says the bout may end as a draw. A bout with a leader
 * ends. Without this an official at a level bracket bout would see a result,
 * and then see it taken back.
 *
 * `score` is the score on the screen, the tablet's unsent hits included: it is
 * the score the End is pressed on, and the queue sends those hits first.
 */
export function endRefusedOnPad(args: {
  matchFormat: MatchFormatConfig;
  phaseType: PhaseType | undefined;
  matchNumberLabel: string | null | undefined;
  elapsedMs: number;
  score: { redScore: number; blueScore: number };
  levelStepsTaken: number;
}): EndRefusedOnPad | null {
  const { matchFormat, phaseType, matchNumberLabel, score } = args;
  if (score.redScore !== score.blueScore) return null;
  if (!timeIsFinished(args.elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    return { reason: 'time_not_finished' };
  }
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, args.levelStepsTaken);
  return step?.kind === 'draw' ? null : { reason: 'level', step };
}
