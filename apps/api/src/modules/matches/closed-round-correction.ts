/**
 * What a correction does to a CLOSED round of a best-of series (ruling 247).
 *
 * A closed round is a snapshot in `matches.rounds_json`: a round ended on time
 * cannot be derived back from its exchanges, so its closure is recorded. The
 * snapshot was never read again, so a void in round 1 during round 2 took the
 * hit off the sheet and left round 1 reading its old score, in silence.
 *
 * The round's SCORE now follows its sheet. Its WINNER never moves: the rounds
 * after it were fought from that result, so a sheet that names another winner
 * is refused whole, as a single fight's correction is once a later bout was
 * fought (ruling 226). The round wins and the series winner are derived from
 * the snapshots' winners, so they cannot move either.
 *
 * Pure. The caller scores the round's own exchanges and cards; this decides.
 */
import { leadingColor } from '@myclash/rulesets';
import type { MaxDoubleHitEndReason, RoundEvaluation } from '@myclash/rulesets';

/** A closed round of a best-of series, as `matches.rounds_json` holds it. */
export interface ClosedRound {
  round: number;
  redScore: number;
  blueScore: number;
  winnerColor: 'red' | 'blue' | null;
  /**
   * The three max-doubles values are one per `maxDoubleHitOutcome`. Only
   * `'max_doubles'` means loss for both; see `maxDoubleHitEndReason`.
   */
  endReason: 'first_to_points' | MaxDoubleHitEndReason | 'time_limit' | null;
}

export type RoundCorrection =
  /** The sheet reads as the snapshot does. */
  | { kind: 'same' }
  /** The same winner under another score: the snapshot to store. */
  | { kind: 'score'; round: ClosedRound }
  /** The sheet no longer gives the round the result it was closed with. */
  | { kind: 'refuse' };

/**
 * `ev` is the round as its sheet reads now. Who it gives the round to: the
 * engine's own answer while an end condition holds, else whoever leads. A round
 * the cap closed may read below the cap: its leader keeps it.
 *
 * A round the doubles ceiling closed must still sit at that ceiling. Its
 * reason says how the round counts (`max_doubles` is a loss for both), and
 * below the ceiling a level board would keep "no winner" under a reason that
 * is no longer true.
 */
export function correctedClosedRound(closed: ClosedRound, ev: RoundEvaluation): RoundCorrection {
  const closedAtTheCeiling = closed.endReason?.startsWith('max_doubles') === true;
  if (closedAtTheCeiling && !(ev.autoOver && ev.endReason === closed.endReason)) {
    return { kind: 'refuse' };
  }
  const winner = ev.autoOver ? ev.winnerColor : leadingColor(ev.score);
  if (winner !== closed.winnerColor) return { kind: 'refuse' };

  const { redScore, blueScore } = ev.score;
  if (redScore === closed.redScore && blueScore === closed.blueScore) return { kind: 'same' };
  return { kind: 'score', round: { ...closed, redScore, blueScore } };
}
