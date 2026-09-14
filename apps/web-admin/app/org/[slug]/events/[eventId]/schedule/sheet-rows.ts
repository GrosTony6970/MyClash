import type { TournamentLengths } from '@myclash/types';

/**
 * A Tournament's own bout lengths on the planner sheet, as the planner edits
 * them (ADR-018). Pure, so the rules below have a test rather than living in a
 * change handler.
 */

export type LengthField = Exclude<keyof TournamentLengths, 'tournamentId'>;

export const LENGTH_FIELDS: readonly LengthField[] = [
  'poolMatchDurationMinutes',
  'swissMatchDurationMinutes',
  'eliminationMatchDurationMinutes',
  'finalsMatchDurationMinutes',
];

/**
 * The rows after one box changes. A number sets that length; a blank box
 * removes it, because blank means "use the Event's" and 0 is not a length.
 */
export function withTournamentLength(
  rows: readonly TournamentLengths[],
  tournamentId: string,
  field: LengthField,
  minutes: number | undefined,
): TournamentLengths[] {
  const hasRow = rows.some((row) => row.tournamentId === tournamentId);
  const base = hasRow ? rows : [...rows, { tournamentId }];
  return base.map((row) =>
    row.tournamentId === tournamentId ? setLength(row, field, minutes) : row,
  );
}

function setLength(
  row: TournamentLengths,
  field: LengthField,
  minutes: number | undefined,
): TournamentLengths {
  const { [field]: _previous, ...rest } = row;
  return minutes === undefined ? rest : { ...rest, [field]: minutes };
}

/**
 * The rows a saved sheet keeps. A row for a Tournament the Event no longer has
 * is ignored when lengths are read and dropped here, on the next save
 * (ADR-018). A row with every box blank says nothing, so it goes too.
 */
export function keepLiveRows(
  rows: readonly TournamentLengths[],
  knownTournamentIds: ReadonlySet<string>,
): TournamentLengths[] {
  return rows.filter(
    (row) =>
      knownTournamentIds.has(row.tournamentId) &&
      LENGTH_FIELDS.some((field) => row[field] !== undefined),
  );
}
