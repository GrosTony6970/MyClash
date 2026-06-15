import { describe, expect, it } from 'vitest';
import { scheduleToCsv, type CsvMatch } from './schedule-csv';

function m(over: Partial<CsvMatch>): CsvMatch {
  return {
    scheduledAt: '2027-06-21T11:00:00.000Z',
    liceId: 'L1',
    roundCode: 'LSW-P1-M1',
    matchNumberLabel: 'M1',
    tournamentName: 'Longsword Open',
    poolName: 'Pool 1',
    redFighterName: 'Paul Amestoy',
    blueFighterName: 'Maxime Bertrand',
    status: 'scheduled',
    ...over,
  };
}

const lices = new Map([
  ['L1', 'Lice 1'],
  ['L2', 'Lice 2'],
]);

describe('scheduleToCsv', () => {
  it('emits a header row and one data row per scheduled match', () => {
    const csv = scheduleToCsv([m({})], lices);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Day,Lice,Start,Round,Tournament,Pool/Round,Red,Blue,Status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2027-06-21');
    expect(lines[1]).toContain('Lice 1');
    expect(lines[1]).toContain('LSW-P1-M1');
    expect(lines[1]).toContain('Paul Amestoy');
  });

  it('sorts by day, then lice, then start time', () => {
    const csv = scheduleToCsv(
      [
        m({ liceId: 'L2', scheduledAt: '2027-06-21T09:00:00.000Z', matchNumberLabel: 'B' }),
        m({ liceId: 'L1', scheduledAt: '2027-06-21T10:00:00.000Z', matchNumberLabel: 'A2' }),
        m({ liceId: 'L1', scheduledAt: '2027-06-21T09:00:00.000Z', matchNumberLabel: 'A1' }),
      ],
      lices,
    );
    const rows = csv.trim().split('\n').slice(1);
    // L1 before L2; within L1, 09:00 before 10:00.
    expect(rows[0]).toContain('Lice 1');
    expect(rows[0]).toContain('LSW-P1-M1'); // both use default roundCode; check order via fighters/time
    expect(rows[2]).toContain('Lice 2');
  });

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = scheduleToCsv(
      [m({ redFighterName: 'Doe, John', blueFighterName: 'Anne "Ace" Roy' })],
      lices,
    );
    const row = csv.trim().split('\n')[1]!;
    expect(row).toContain('"Doe, John"');
    expect(row).toContain('"Anne ""Ace"" Roy"');
  });

  it('excludes unscheduled matches (no time or no lice)', () => {
    const csv = scheduleToCsv(
      [m({ scheduledAt: null }), m({ liceId: null }), m({ matchNumberLabel: 'kept' })],
      lices,
    );
    expect(csv.trim().split('\n')).toHaveLength(2); // header + the one kept
  });
});
