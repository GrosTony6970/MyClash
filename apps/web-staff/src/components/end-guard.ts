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
  type CapScore,
  type LevelStep,
  type MatchFormatConfig,
} from '@myclash/types';
import type { PressedOn } from '../offline/db';
import { timeIsFinished, type PhaseType } from './scoreboard-clock';

export function endIsEarly(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
  elapsedMs: number,
  score: CapScore,
): boolean {
  if (pointCapWinnerColor(score, matchFormat) !== null) return false;
  return !timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel);
}

/**
 * Who won a bout whose board is level, or nobody.
 *
 * One board is level and has a winner: a bout that counts down, with both
 * fighters out of points on one exchange. It reads 0 - 0, and the fighter less
 * far below zero has won (operator, 2026-10-11). The score on the pad says how
 * far under each side went (`scoreOnPad`). A board with a leader answers
 * nobody here: its leader is read from the board, as before.
 */
export function levelBoardWinner(
  score: CapScore,
  matchFormat: MatchFormatConfig,
): 'red' | 'blue' | null {
  if (score.redScore !== score.blueScore) return null;
  return pointCapWinnerColor(score, matchFormat);
}

/**
 * What an End is pressed on: the score on the screen, and the fighter the cap
 * has given the bout or the round to, when it has. In a bout that counts down
 * with both fighters out of points the board does not name that fighter: it
 * reads 0 - 0, or 0 and -1 after a card, for the one who is less far below.
 * With no winner here, the result reads its leader from the two numbers.
 */
export function pressedOn(score: CapScore, matchFormat: MatchFormatConfig): PressedOn {
  const winner = pointCapWinnerColor(score, matchFormat);
  return { red: score.redScore, blue: score.blueScore, ...(winner ? { winner } : {}) };
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
 * ends, and so does a level board that has a winner (`levelBoardWinner`).
 * Without this an official at a level bracket bout would see a result, and
 * then see it taken back.
 *
 * `score` is the score on the screen, the tablet's unsent hits included: it is
 * the score the End is pressed on, and the queue sends those hits first.
 */
export function endRefusedOnPad(args: {
  matchFormat: MatchFormatConfig;
  phaseType: PhaseType | undefined;
  matchNumberLabel: string | null | undefined;
  elapsedMs: number;
  score: CapScore;
  levelStepsTaken: number;
}): EndRefusedOnPad | null {
  const { matchFormat, phaseType, matchNumberLabel, score } = args;
  if (score.redScore !== score.blueScore) return null;
  if (levelBoardWinner(score, matchFormat) !== null) return null;
  if (!timeIsFinished(args.elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    return { reason: 'time_not_finished' };
  }
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, args.levelStepsTaken);
  return step?.kind === 'draw' ? null : { reason: 'level', step };
}
