import type { ExchangeRow } from '../types/match-events';

/**
 * A venue is won by a clean hit that still stands: not voided, and with a side
 * that scored it. The pad's tally and the "Venues 3/5" counter both read this.
 */
export function isWonVenue(row: Pick<ExchangeRow, 'type' | 'voided' | 'scoringSide'>): boolean {
  return row.type === 'clean' && !row.voided && !!row.scoringSide;
}

/** The venues won in `round`. A row with no round number is of round 1, as the server reads it. */
export function venuesWonInRound(rows: readonly ExchangeRow[], round: number): number {
  return rows.filter((row) => (row.round_number ?? 1) === round && isWonVenue(row)).length;
}
