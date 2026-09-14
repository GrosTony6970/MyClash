import type { SuggestConfig, TournamentLengths } from '@myclash/types';

/**
 * How long a bout of a given kind lasts, read from the Event's planner sheet.
 *
 * ADR-018: the sheet is the one place an organiser types a bout length. A
 * Tournament may carry its own lengths on the same sheet; a blank one reads the
 * Event's. A Swiss bout with no Swiss length of its own takes the pool length,
 * at each level. So the order for a Swiss bout is: the Tournament's Swiss
 * length, the Tournament's pool length, the Event's Swiss length, the Event's
 * pool length.
 *
 * Pure: the caller loads the sheet. Suggest is the first caller; Generate, the
 * re-fan and every reader of a Match's window follow in later slices.
 */
export type MatchKind = 'pool' | 'swiss' | 'elimination' | 'finals';

export function sheetLengthFor(
  kind: MatchKind,
  sheet: SuggestConfig,
  tournamentId: string,
): number {
  const row = sheet.tournaments.find((r) => r.tournamentId === tournamentId);
  const own = row === undefined ? undefined : tournamentLength(kind, row);
  return own ?? eventLength(kind, sheet);
}

/** A Tournament's own number for the kind, or undefined when its box is blank. */
function tournamentLength(kind: MatchKind, row: TournamentLengths): number | undefined {
  switch (kind) {
    case 'pool':
      return row.poolMatchDurationMinutes;
    case 'swiss':
      return row.swissMatchDurationMinutes ?? row.poolMatchDurationMinutes;
    case 'elimination':
      return row.eliminationMatchDurationMinutes;
    case 'finals':
      return row.finalsMatchDurationMinutes;
  }
}

/** The Event's number for the kind. Only the Swiss length may be blank. */
function eventLength(kind: MatchKind, sheet: SuggestConfig): number {
  switch (kind) {
    case 'pool':
      return sheet.poolMatchDurationMinutes;
    case 'swiss':
      return sheet.swissMatchDurationMinutes ?? sheet.poolMatchDurationMinutes;
    case 'elimination':
      return sheet.eliminationMatchDurationMinutes;
    case 'finals':
      return sheet.finalsMatchDurationMinutes;
  }
}
