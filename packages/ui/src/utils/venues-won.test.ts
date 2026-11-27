import { describe, expect, it } from 'vitest';
import type { ExchangeRow } from '../types/match-events';
import { isWonVenue, venuesWonInRound } from './venues-won';

let seq = 0;
function row(over: Partial<ExchangeRow> = {}): ExchangeRow {
  seq += 1;
  return {
    id: `ex-${seq}`,
    sequence: seq,
    type: 'clean',
    voided: false,
    occurredAt: '2027-06-21T10:00:00.000Z',
    clockTimeMs: seq * 1000,
    scoringSide: 'red',
    scoreDelta: 1,
    defenderDelta: null,
    ...over,
  };
}

describe('isWonVenue', () => {
  it('is a clean hit with a side, not voided', () => {
    expect(isWonVenue(row())).toBe(true);
    expect(isWonVenue(row({ voided: true }))).toBe(false);
    expect(isWonVenue(row({ scoringSide: null }))).toBe(false);
    expect(isWonVenue(row({ type: 'afterblow' }))).toBe(false);
    expect(isWonVenue(row({ type: 'double', scoringSide: null }))).toBe(false);
    expect(isWonVenue(row({ type: 'no_exchange', scoringSide: null }))).toBe(false);
  });
});

describe('venuesWonInRound', () => {
  const rows = [
    row({ round_number: 1 }),
    row({ round_number: 1, scoringSide: 'blue' }),
    row({ round_number: 1, type: 'afterblow' }),
    row({ round_number: 1, type: 'double', scoringSide: null }),
    row({ round_number: 1, type: 'no_exchange', scoringSide: null }),
    row({ round_number: 1, voided: true }),
    row({ round_number: 2 }),
  ];

  it('counts the won venues of the asked round only', () => {
    expect(venuesWonInRound(rows, 1)).toBe(2);
    expect(venuesWonInRound(rows, 2)).toBe(1);
  });

  it('reads a row with no round number as round 1', () => {
    expect(venuesWonInRound([row(), row({ round_number: null })], 1)).toBe(2);
  });
});
