/**
 * board-unit-ends.ts — when a referee board unit starts and ends, and how long its bouts are.
 *
 * A unit (a Pool, a Swiss round on one piste, one bracket bout) runs over the hull of
 * its placed bouts' windows (ADR-017): the earliest start to the latest planned end,
 * each bout as long as the Event's sheet or its own override says (ADR-018). That is the
 * rule the schedule grid draws a Pool's bar with (`buildScheduleBlocks`), so the board
 * and the grid agree on when a crew is busy.
 *
 * ONE hull gives both ends. The start used to be the loaders' own: a text sort of the
 * bouts' ISO strings for a Pool, the first bout for a Swiss unit, the one bout for a
 * bracket. Three owners of a start, compared as strings, while the end was measured.
 *
 * The three loaders build units with neither end and their bouts without a length
 * (`DraftBoardUnit`); the service resolves every bout's length ONCE for the whole board
 * and hands the map here. One owner for all three kinds, so a Swiss unit cannot start or
 * end by a rule a Pool does not.
 *
 * Pure: no I/O.
 */

import { hullMs, matchWindowMs, type TimeWindowMs } from '@myclash/schedule-core';
import type { MatchLengthInput } from '../schedule/match-lengths';
import { plannedLengthOf } from '../schedule/planned-length';
import type { AssignmentBoardPool } from './assignment-board.service';

type BoardUnitMatch = AssignmentBoardPool['matches'][number];

/** A unit's bout as a loader reads it: no length yet, and what its length comes from. */
export type DraftUnitMatch = Omit<BoardUnitMatch, 'durationMinutes'> &
  Pick<MatchLengthInput, 'phaseId' | 'plannedDurationOverrideMinutes'>;

/** A unit as a loader builds it: everything but its two ends and its bouts' lengths. */
export type DraftBoardUnit = Omit<
  AssignmentBoardPool,
  'scheduledStart' | 'scheduledEnd' | 'matches'
> & {
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

/** One bout's planned window, or null when it has no time. */
export function boutWindowMs(bout: {
  scheduledAt: string | null;
  durationMinutes: number;
}): TimeWindowMs | null {
  return bout.scheduledAt === null ? null : matchWindowMs(bout.scheduledAt, bout.durationMinutes);
}

/** The hull of a unit's placed bouts, or null when none is placed. */
export function unitWindowMs(unit: Pick<AssignmentBoardPool, 'matches'>): TimeWindowMs | null {
  return hullMs(
    unit.matches.flatMap((bout) => {
      const window = boutWindowMs(bout);
      return window ? [window] : [];
    }),
  );
}

/**
 * Each bout gets its planned length and each unit its two ends from one hull. A unit
 * nobody has placed has neither.
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
    const hull = unitWindowMs({ matches: timed });
    return {
      ...unit,
      scheduledStart: hull ? new Date(hull.startMs).toISOString() : null,
      scheduledEnd: hull ? new Date(hull.endMs).toISOString() : null,
      matches: timed,
    };
  });
}
