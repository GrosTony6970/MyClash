import { describe, expect, it } from 'vitest';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import { createTranslator, messages } from '@myclash/i18n';
import { roundGroupName } from '@myclash/ui';
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

const TZ = 'Europe/Paris';

/** The file's lines, after the byte-order mark, without the last line end. */
const linesOf = (csv: string) => csv.slice(1).replace(/\r\n$/, '').split('\r\n');

/** Headers come from `t()` at the call site; English here mirrors the EN pack. */
const LABELS = {
  day: 'Day',
  lice: 'Lice',
  start: 'Start',
  round: 'Round',
  tournament: 'Tournament',
  group: 'Pool/Round',
  red: 'Red',
  blue: 'Blue',
  status: 'Status',
  roundName: (token: string) => `round:${token}`,
};

/**
 * A French organiser exported the schedule and read "Round of 16" in the group column.
 * Every round a code can carry is named in French, by the same words as the board.
 */
describe('the group column of a bracket or Swiss bout', () => {
  const frT = createTranslator(messages.fr);
  const groupOf = (roundCode: string) => {
    const labels = { ...LABELS, roundName: (token: string) => roundGroupName(token, frT) };
    const csv = scheduleToCsv([m({ roundCode, poolName: null })], lices, TZ, labels, CSV_STANDARD);
    return linesOf(csv)[1]!.split(',')[5];
  };

  it('names the round in French', () => {
    expect(groupOf('LSW-B-R16-M1')).toBe('Huitièmes de finale');
    expect(groupOf('LSW-B-QF-M2')).toBe('Quarts de finale');
  });

  it('names every round a code can carry, never by the Bracket fallback', () => {
    const tokens = ['PI', 'R32', 'SF', 'F', 'B4', 'WBF', 'WBSF', 'WBQF', 'WBR16', 'WBB3'];
    const codes = [...tokens.map((tk) => `LSW-B-${tk}-M1`), 'LSW-B-LB2-M1', 'LSW-B-GF-M1'];
    for (const code of [...codes, 'LSW-B-GFR-M1', 'LSW-S3-M1']) {
      expect(groupOf(code), code).not.toBe('Tableau');
      expect(groupOf(code), code).not.toBe('');
    }
  });
});

describe('scheduleToCsv', () => {
  it('starts with the byte-order mark, so a spreadsheet reads accents as written', () => {
    expect(scheduleToCsv([m({})], lices, TZ, LABELS, CSV_STANDARD).charCodeAt(0)).toBe(0xfeff);
  });

  it('emits a header row and one data row per scheduled match', () => {
    const csv = scheduleToCsv([m({})], lices, TZ, LABELS, CSV_STANDARD);
    const lines = linesOf(csv);
    expect(lines[0]).toBe('Day,Lice,Start,Round,Tournament,Pool/Round,Red,Blue,Status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2027-06-21');
    expect(lines[1]).toContain('Lice 1');
    expect(lines[1]).toContain('LSW-P1-M1');
    expect(lines[1]).toContain('Paul Amestoy');
  });

  it('for French Excel, splits on ; and leaves a comma of a name bare', () => {
    const csv = scheduleToCsv(
      [m({ redFighterName: 'Doe, John' })],
      lices,
      TZ,
      LABELS,
      CSV_EXCEL_FR,
    );
    const [header, row] = linesOf(csv);
    expect(header).toBe('Day;Lice;Start;Round;Tournament;Pool/Round;Red;Blue;Status');
    expect(row!.split(';')).toHaveLength(9);
    expect(row).toContain(';Doe, John;');
  });

  it('sorts by day, then lice, then start time', () => {
    const csv = scheduleToCsv(
      [
        m({ liceId: 'L2', scheduledAt: '2027-06-21T09:00:00.000Z', matchNumberLabel: 'B' }),
        m({ liceId: 'L1', scheduledAt: '2027-06-21T10:00:00.000Z', matchNumberLabel: 'A2' }),
        m({ liceId: 'L1', scheduledAt: '2027-06-21T09:00:00.000Z', matchNumberLabel: 'A1' }),
      ],
      lices,
      TZ,
      LABELS,
      CSV_STANDARD,
    );
    const rows = linesOf(csv).slice(1);
    // L1 before L2; within L1, 09:00 before 10:00.
    expect(rows[0]).toContain('Lice 1');
    expect(rows[0]).toContain('LSW-P1-M1'); // both use default roundCode; check order via fighters/time
    expect(rows[2]).toContain('Lice 2');
  });

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = scheduleToCsv(
      [m({ redFighterName: 'Doe, John', blueFighterName: 'Anne "Ace" Roy' })],
      lices,
      TZ,
      LABELS,
      CSV_STANDARD,
    );
    const row = linesOf(csv)[1]!;
    expect(row).toContain('"Doe, John"');
    expect(row).toContain('"Anne ""Ace"" Roy"');
  });

  /**
   * This file is printed and taped up at the venue, so every time on it has to
   * be the venue's. `Intl.DateTimeFormat(undefined, …)` used the RUNTIME's zone
   * and locale, and the Day column came from `scheduledAt.slice(0, 10)` — the
   * UTC prefix — so a bout just after midnight filed under the previous day.
   */
  it('writes the start time on the event wall clock', () => {
    // 07:00Z is 09:00 in Paris (CEST) and 03:00 in New York.
    const csv = scheduleToCsv(
      [m({ scheduledAt: '2027-06-21T07:00:00.000Z' })],
      lices,
      'Europe/Paris',
      LABELS,
      CSV_STANDARD,
    );

    expect(linesOf(csv)[1]).toContain('09:00');
  });

  it('files a bout after midnight under the event day, not the UTC day', () => {
    // 22:30Z on the 20th is 00:30 on the 21st in Paris.
    const csv = scheduleToCsv(
      [m({ scheduledAt: '2027-06-20T22:30:00.000Z' })],
      lices,
      'Europe/Paris',
      LABELS,
      CSV_STANDARD,
    );
    const row = linesOf(csv)[1]!;

    expect(row).toContain('2027-06-21');
    expect(row).not.toContain('2027-06-20');
    expect(row).toContain('00:30');
  });

  it('takes its headers from the caller rather than hardcoding English', () => {
    const csv = scheduleToCsv(
      [m({})],
      lices,
      TZ,
      { ...LABELS, day: 'Jour', red: 'Rouge' },
      CSV_STANDARD,
    );

    expect(linesOf(csv)[0]).toBe('Jour,Lice,Start,Round,Tournament,Pool/Round,Rouge,Blue,Status');
  });

  it('excludes unscheduled matches (no time or no lice)', () => {
    const csv = scheduleToCsv(
      [m({ scheduledAt: null }), m({ liceId: null }), m({ matchNumberLabel: 'kept' })],
      lices,
      TZ,
      LABELS,
      CSV_STANDARD,
    );
    expect(linesOf(csv)).toHaveLength(2); // header + the one kept
  });
});
