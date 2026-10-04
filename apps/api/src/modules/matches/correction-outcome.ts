/**
 * What a correction does to a bout that is already finished.
 *
 * A void, a restored void, an edit or a voided card moves the score of a
 * completed bout. The score is derived, so it always follows. The RESULT was
 * not: `winner_registration_id` was written once, on the way into `completed`,
 * and the only way back was a reopen that an over Event always refuses and a
 * fought later bout refuses too. The refusal was swallowed, so the sheet read
 * 3-4 beside a winner on 3 (rulings 225 to 229).
 *
 * One owner, asked twice: by the doors BEFORE they write (a refusal must leave
 * nothing behind, and there is no transaction), and by the recompute after.
 *
 * Pure. The caller reads the bout, the Event and the bracket; this decides.
 */
import { boutOutcomes, leadingColor } from '@myclash/rulesets';

export type CorrectionRefusalCode =
  | 'correction_later_bout_fought'
  | 'correction_leaves_bout_level'
  /** A best-of series: the change takes a closed round from its winner (ruling 247). */
  | 'correction_changes_closed_round';

export type CorrectionOutcome =
  /** Not completed, or the result stands: only the score moves. */
  | { kind: 'unchanged' }
  /** A running Event's bout is no longer over: it goes back to the referee. */
  | { kind: 'reopen' }
  /** The bout stays finished and names its result again. */
  | { kind: 'redecide'; winnerRegistrationId: string | null; endReason: string }
  | { kind: 'refuse'; code: CorrectionRefusalCode };

export interface CorrectionInput {
  /** The bout as it is stored, before the correction. */
  bout: {
    status: string;
    winnerRegistrationId: string | null;
    endReason: string | null;
    redRegistrationId: string | null;
    blueRegistrationId: string | null;
    redScore: number;
    blueScore: number;
  };
  /** The score once the correction is in. */
  score: { redScore: number; blueScore: number };
  /** What the ruleset says about that score: the cap, the doubles ceiling. */
  engine: { isOver: false } | { isOver: true; reason: string; winnerRegistrationId: string | null };
  /**
   * Nobody will end this bout again: the Event is over (completed or archived),
   * or a later Swiss round was already drawn, which refuses a reopen.
   */
  staysFinished: boolean;
  /** A bout this one feeds has been fought with the stored result. */
  laterBoutFought: boolean;
  /** The Tournament's own rules let this bout end level. */
  drawAllowed: boolean;
}

/**
 * The end reasons a correction may decide again: the ones the engine and the
 * clock write from the board. Named one by one ON PURPOSE. A forfeit, a black
 * card or a spent series awards the bout for a reason the score does not
 * hold, so the score must never take it back, and a reason added later stays
 * out until somebody places it here. A bout with no reason at all is left
 * alone too, except the drawn one `storedReason` names.
 */
const DECIDED_ON_THE_BOARD: readonly string[] = [
  'first_to_points',
  'time_limit',
  'max_doubles',
  'max_doubles_draw',
  'max_doubles_result_stands',
];

/**
 * Why the bout ended. A level bout the clock ended as a draw carries NO reason
 * (`timeLimitResult` completes it with nothing), so "no reason, no winner, a
 * level board" is read as that draw: it is the commonest drawn bout there is.
 */
function storedReason(bout: CorrectionInput['bout']): string | null {
  if (bout.endReason !== null) return bout.endReason;
  const drawn = bout.winnerRegistrationId === null && bout.redScore === bout.blueScore;
  return drawn ? 'time_limit' : null;
}

export function correctionOutcome(input: CorrectionInput): CorrectionOutcome {
  const { bout, score, engine, staysFinished, laterBoutFought, drawAllowed } = input;
  if (bout.status !== 'completed') return { kind: 'unchanged' };

  // What a running Event has always done with a bout the engine no longer
  // ends: hand it back. An over Event has nobody to hand it to.
  const backToTheReferee = !staysFinished && !engine.isOver;

  if (!DECIDED_ON_THE_BOARD.includes(storedReason(bout) ?? '')) {
    return backToTheReferee ? { kind: 'reopen' } : { kind: 'unchanged' };
  }

  // Decided as the End button decides: the engine's own answer while its end
  // condition holds, else whoever leads, and nobody when the board is level.
  const leader = leadingColor(score);
  const winnerRegistrationId = engine.isOver
    ? engine.winnerRegistrationId
    : leader === 'red'
      ? bout.redRegistrationId
      : leader === 'blue'
        ? bout.blueRegistrationId
        : null;
  const endReason = engine.isOver ? engine.reason : 'time_limit';

  const before = boutOutcomes(bout);
  const after = boutOutcomes({ ...bout, ...score, winnerRegistrationId, endReason });
  const changes = before.red !== after.red || before.blue !== after.blue;

  if (changes && laterBoutFought) return { kind: 'refuse', code: 'correction_later_bout_fought' };
  if (backToTheReferee) return { kind: 'reopen' };
  if (!changes) return { kind: 'unchanged' };
  if (!engine.isOver && leader === null && !drawAllowed) {
    return { kind: 'refuse', code: 'correction_leaves_bout_level' };
  }
  return { kind: 'redecide', winnerRegistrationId, endReason };
}
