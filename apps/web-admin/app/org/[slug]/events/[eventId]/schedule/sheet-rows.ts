import type { TournamentLengths } from '@myclash/types';

/**
 * A Tournament's own bout lengths on the planner sheet, as the planner edits
 * them (ADR-018). Pure, so the rules below have a test rather than living in a
 * change handler.
 */

/** Every number a Tournament's row can hold. */
export type TournamentField = Exclude<keyof TournamentLengths, 'tournamentId'>;

/** The four that are bout lengths: the row's length columns, in order. */
export type LengthField = Exclude<TournamentField, 'minRestMinutes'>;

export const LENGTH_FIELDS: readonly LengthField[] = [
  'poolMatchDurationMinutes',
  'swissMatchDurationMinutes',
  'eliminationMatchDurationMinutes',
  'finalsMatchDurationMinutes',
];

/** Every field a row can carry, for deciding whether a row says anything. */
const TOURNAMENT_FIELDS: readonly TournamentField[] = [...LENGTH_FIELDS, 'minRestMinutes'];

/**
 * The rows after one box on a Tournament's row changes. A number is kept —
 * including 0, which is a rest of none — and a blank box removes the field, so
 * the Tournament reads the Event's number again (ADR-018).
 *
 * One setter for every box: the rest behaves exactly as the four lengths do,
 * and a second copy pinned to one field would only be somewhere for the two to
 * drift apart.
 */
export function withTournamentField(
  rows: readonly TournamentLengths[],
  tournamentId: string,
  field: TournamentField,
  minutes: number | undefined,
): TournamentLengths[] {
  const hasRow = rows.some((row) => row.tournamentId === tournamentId);
  const base = hasRow ? rows : [...rows, { tournamentId }];
  return base.map((row) => (row.tournamentId === tournamentId ? set(row, field, minutes) : row));
}

function set(
  row: TournamentLengths,
  field: TournamentField,
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
      TOURNAMENT_FIELDS.some((field) => row[field] !== undefined),
  );
}
