/**
 * "End match" pressed while the bout is not over by its own rules: the pad asks
 * before it ends the clock (operator ruling, 2026-10-08).
 *
 * The button sits just under Pause. An official who means Pause and hits it
 * ends the bout, and Re-open needs the network: with the wifi down the bout
 * stays ended. A normal end is not slowed: once a fighter is at the cap, the
 * doubles limit or the venue limit is reached, or the time is reached, the
 * press ends the bout at once.
 *
 * A phase with no time limit has no time to wait for (`timeIsFinished` answers
 * true there), so its End is never early.
 */
import {
  pendingLevelStep,
  pointCapWinnerColor,
  roundOutcome,
  type CapScore,
  type DecisionEdition,
  type LevelStep,
  type MatchFormatConfig,
} from '@myclash/types';
import type { LimitReason, PressedOn } from '../offline/db';
import { timeIsFinished, type PhaseType } from './scoreboard-clock';

/**
 * The score an End is judged on: the board, and the doubles and the venues won of the bout or
 * the round.
 */
export type EndBoard = CapScore & { doubles: number; redVenuesWon: number; blueVenuesWon: number };

/** The two things of a bout that say which rules of the format it is under. */
interface BoutPhase {
  phaseType?: PhaseType | null;
  matchNumberLabel?: string | null;
}

/** Is the bout over by itself on this board, and why: the server's own rule (`roundOutcome`). */
function outcomeOn(
  score: EndBoard,
  bout: BoutPhase,
  matchFormat: MatchFormatConfig,
  edition: DecisionEdition,
) {
  const phase = { phaseType: bout.phaseType ?? undefined, matchNumberLabel: bout.matchNumberLabel };
  return roundOutcome(phase, score, matchFormat, edition);
}

/**
 * The bout stands at its venue limit, and for whom (null: a level board that may end level).
 * Null when it does not. A venues bout of one round ends there as a bout at the cap does: the End
 * is the result, not early and not refused, and the board stands.
 */
function venueLimitEnd(
  score: EndBoard,
  bout: BoutPhase,
  matchFormat: MatchFormatConfig,
  edition: DecisionEdition,
): { winnerColor: 'red' | 'blue' | null } | null {
  const { endReason, winnerColor } = outcomeOn(score, bout, matchFormat, edition);
  return endReason === 'venue_limit' ? { winnerColor } : null;
}

/**
 * The bout stands at its doubles limit: the reason it ends for, one per outcome
 * of the format, or null under the limit and where the bout has none (a bracket).
 *
 * The server ends a bout of one round at its limit by `roundOutcome`, on the
 * double that reaches it. The tablet ends no bout of one round by itself: the
 * official presses "End match", as at the cap. With no network that press is
 * all there is, so it must say what the server will say (operator,
 * 2026-10-11). Before, it named the leader on the board, and it refused a
 * level board "until the time is finished".
 *
 * A board at the cap AND at the limit is the cap's in a bout that counts up:
 * `roundOutcome` owns that order, and this answers null there. A board at the
 * venue limit is no doubles limit either (`venueLimitEnd`): null.
 */
export function limitEnd(
  score: EndBoard,
  bout: BoutPhase,
  matchFormat: MatchFormatConfig,
  edition: DecisionEdition,
): LimitReason | null {
  const { endReason } = outcomeOn(score, bout, matchFormat, edition);
  return endReason === 'first_to_points' || endReason === 'venue_limit' ? null : endReason;
}

export function endIsEarly(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
  elapsedMs: number,
  score: EndBoard,
  edition: DecisionEdition,
): boolean {
  const bout = { phaseType, matchNumberLabel };
  if (pointCapWinnerColor(score, matchFormat, edition) !== null) return false;
  if (limitEnd(score, bout, matchFormat, edition) !== null) return false;
  if (venueLimitEnd(score, bout, matchFormat, edition)) return false;
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
  edition: DecisionEdition,
): 'red' | 'blue' | null {
  if (score.redScore !== score.blueScore) return null;
  return pointCapWinnerColor(score, matchFormat, edition);
}

/**
 * What an End is pressed on: the score on the screen, and the fighter the cap
 * has given the bout or the round to, when it has. In a bout that counts down
 * with both fighters out of points the board does not name that fighter: it
 * reads 0 - 0, or 0 and -1 after a card, for the one who is less far below.
 * With no winner here, `tabletWinner` reads its leader from the two numbers.
 *
 * At the doubles limit it is the format's outcome: the reason, and the board
 * that outcome leaves. A format that wipes the board leaves 0 - 0 and nobody;
 * "the result stands" leaves the board, whose leader `tabletWinner` reads from
 * the two numbers as for any End.
 *
 * At the venue limit the board stands and the winner is the one the venue
 * count names; the cap is not read there, as the server does not read it.
 */
export function pressedOn(
  score: EndBoard,
  matchFormat: MatchFormatConfig,
  bout: BoutPhase,
  edition: DecisionEdition,
): PressedOn {
  const endReason = limitEnd(score, bout, matchFormat, edition);
  if (endReason) {
    const wiped = endReason !== 'max_doubles_result_stands';
    return { red: wiped ? 0 : score.redScore, blue: wiped ? 0 : score.blueScore, endReason };
  }
  const venues = venueLimitEnd(score, bout, matchFormat, edition);
  const winner = venues ? venues.winnerColor : pointCapWinnerColor(score, matchFormat, edition);
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
 * A bout at its doubles limit ends, level or not: the limit is the result
 * (`limitEnd`), and the server has ended that bout on its last double. So does
 * a bout at its venue limit (`venueLimitEnd`).
 *
 * `score` is the score on the screen, the tablet's unsent hits included: it is
 * the score the End is pressed on, and the queue sends those hits first.
 */
export function endRefusedOnPad(args: {
  matchFormat: MatchFormatConfig;
  phaseType: PhaseType | undefined;
  matchNumberLabel: string | null | undefined;
  elapsedMs: number;
  score: EndBoard;
  levelStepsTaken: number;
  edition: DecisionEdition;
}): EndRefusedOnPad | null {
  const { matchFormat, phaseType, matchNumberLabel, score, edition } = args;
  const bout = { phaseType, matchNumberLabel };
  if (limitEnd(score, bout, matchFormat, edition) !== null) return null;
  if (venueLimitEnd(score, bout, matchFormat, edition)) return null;
  if (score.redScore !== score.blueScore) return null;
  if (levelBoardWinner(score, matchFormat, edition) !== null) return null;
  if (!timeIsFinished(args.elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    return { reason: 'time_not_finished' };
  }
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, args.levelStepsTaken);
  return step?.kind === 'draw' ? null : { reason: 'level', step };
}
