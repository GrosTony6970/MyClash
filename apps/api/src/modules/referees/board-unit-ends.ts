/**
 * board-unit-ends.ts — when a referee board unit ends, and how long its bouts are.
 *
 * A unit (a Pool, a Swiss round on one piste, one bracket bout) ends when its
 * last placed bout is planned to finish: the END of the hull of its bouts'
 * windows (ADR-017), each bout as long as the Event's sheet or its own override
 * says (ADR-018). That is the rule the schedule grid draws a Pool's bar with
 * (`buildScheduleBlocks`), so the board and the grid agree on when a crew is
 * free.
 *
 * It replaces the median gap between bout STARTS plus a five-minute fallback,
 * which could not see a long final and called a one-bout unit five minutes.
 *
 * The three loaders build units without an end and their bouts without a
 * length (`DraftBoardUnit`); the service resolves every bout's length ONCE for
 * the whole board and hands the map here. One owner for all three kinds, so a
 * Swiss unit cannot end by a rule a Pool does not.
 *
 * Pure: no I/O.
 */

import type { MatchLengthInput } from '../schedule/match-lengths';
import { plannedEndIso, plannedLengthOf } from '../schedule/planned-length';
import type { AssignmentBoardPool } from './assignment-board.service';

type BoardUnitMatch = AssignmentBoardPool['matches'][number];

/** A unit's bout as a loader reads it: no length yet, and what its length comes from. */
export type DraftUnitMatch = Omit<BoardUnitMatch, 'durationMinutes'> &
  Pick<MatchLengthInput, 'phaseId' | 'plannedDurationOverrideMinutes'>;

/** A unit as a loader builds it: everything but its end and its bouts' lengths. */
export type DraftBoardUnit = Omit<AssignmentBoardPool, 'scheduledEnd' | 'matches'> & {
  matches: DraftUnitMatch[];
};

/** Every bout of every unit, as `resolveMatchLengths` asks for them. */
export function lengthInputsOf(units: readonly DraftBoardUnit[]): MatchLengthInput[] {
  return units.flatMap((unit) =>
    unit.matches.map((match) => ({
      id: match.id,
      phaseId: match.phaseId,
      plannedDurationOverrideMinutes: match.plannedDurationOverrideMinutes,
    })),
  );
}

/**
 * Each bout gets its planned length and each unit its planned end
 * (`plannedEndIso`). A unit nobody has placed has no end to measure a crew
 * against.
 */
export function finishBoardUnits(
  units: readonly DraftBoardUnit[],
  lengths: ReadonlyMap<string, number>,
): AssignmentBoardPool[] {
  return units.map(({ matches, ...unit }) => {
    const timed: BoardUnitMatch[] = matches.map((match) => ({
      id: match.id,
      scheduledAt: match.scheduledAt,
      liceId: match.liceId,
      redRegistrationId: match.redRegistrationId,
      blueRegistrationId: match.blueRegistrationId,
      durationMinutes: plannedLengthOf(lengths, match.id),
    }));
    return { ...unit, scheduledEnd: plannedEndIso(timed), matches: timed };
  });
}
