import { exchangeDeltas } from '@myclash/types';
import type { ExchangeRow } from '../types/match-events';

/**
 * A venue is won by a hit that still stands (not voided) and that the rules say won one
 * (`exchangeDeltas`: a clean hit, for its striker). The pad's tally and the "Venues 3/5" counter
 * both read this. The row names its striker as `scoringSide`; who won a venue reads no unit and
 * no afterblow mode, so the two given here change nothing.
 */
export function isWonVenue(row: Pick<ExchangeRow, 'type' | 'voided' | 'scoringSide'>): boolean {
  if (row.voided) return false;
  const exchange = {
    type: row.type,
    firstStrikerColor: row.scoringSide ?? null,
    firstStrikeValue: null,
    afterblowValue: null,
  };
  return exchangeDeltas(exchange, 'full', 'venues').venue !== null;
}

/** The venues won in `round`. A row with no round number is of round 1, as the server reads it. */
export function venuesWonInRound(rows: readonly ExchangeRow[], round: number): number {
  return rows.filter((row) => (row.round_number ?? 1) === round && isWonVenue(row)).length;
}
