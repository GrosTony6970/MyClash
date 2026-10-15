import { describe, expect, it, vi } from 'vitest';
import { ExportsController } from './exports.controller';
import type { TournamentReportRows } from './archive-reports';

/**
 * The Archive page's four CSV downloads each ask which file (operator, 2026-10-15): `?csv=excel-fr`
 * is French Excel's (`;`), no value the standard one (`,`). Both start with the byte-order mark.
 */
const REPORTS: TournamentReportRows = {
  matches: [
    ['match_id', 'round_code'],
    ['m-1', 'LSW-P1-M1'],
  ],
  exchanges: [
    ['exchange_id', 'match_id'],
    ['x-1', 'm-1'],
  ],
  results: [
    ['round_code', 'winner'],
    ['LSW-P1-M1', 'Léa'],
  ],
  rankings: [
    ['rank', 'name'],
    [1, 'Léa'],
  ],
};
const FULL = [
  ['tournament', 'voided_reason'],
  ['Longsword', 'ref, error'],
];

function sent() {
  const out = { headers: {} as Record<string, string>, body: '' };
  const reply = {
    header(name: string, value: string) {
      out.headers[name] = value;
      return reply;
    },
    send(body: string) {
      out.body = body;
      return reply;
    },
  };
  return { out, reply: reply as never };
}

function controller() {
  const exportsService = { generateFullCsvRows: vi.fn(async () => FULL) };
  const archives = {
    assertEventAdmin: vi.fn(async () => ({})),
    generateTournamentReportRows: vi.fn(async () => REPORTS),
  };
  return new ExportsController(
    exportsService as never,
    {} as never,
    archives as never,
    {} as never,
  );
}

const REQ = { headers: {} } as never;
type Route = (query: { csv: 'excel-fr' | 'standard' }, reply: never) => Promise<void>;
const ROUTES: Array<[string, string, Route]> = [
  [
    'matches.csv',
    'match_id;round_code',
    (q, r) => controller().tournamentMatchesCsv('t', q, REQ, r),
  ],
  [
    'exchanges.csv',
    'exchange_id;match_id',
    (q, r) => controller().tournamentExchangesCsv('t', q, REQ, r),
  ],
  ['rankings.csv', 'rank;name', (q, r) => controller().tournamentRankingsCsv('t', q, REQ, r)],
  ['exchanges.csv', 'tournament;voided_reason', (q, r) => controller().fullCsv('e', q, REQ, r)],
];

describe('the CSV downloads of the Archive page', () => {
  for (const [filename, frenchHeader, route] of ROUTES) {
    it(`${frenchHeader.split(';')[0]}: the French Excel file when asked, the standard one else`, async () => {
      const french = sent();
      await route({ csv: 'excel-fr' }, french.reply);
      expect(french.out.body.startsWith(`\uFEFF${frenchHeader}\r\n`)).toBe(true);
      expect(french.out.headers['Content-Disposition']).toBe(`attachment; filename="${filename}"`);
      expect(french.out.headers['Content-Type']).toBe('text/csv; charset=utf-8');

      const standard = sent();
      await route({ csv: 'standard' }, standard.reply);
      expect(standard.out.body.startsWith(`\uFEFF${frenchHeader.replace(';', ',')}\r\n`)).toBe(
        true,
      );
    });
  }

  it('quotes a comma of free text in the standard file only', async () => {
    const french = sent();
    await controller().fullCsv('e', { csv: 'excel-fr' }, REQ, french.reply);
    expect(french.out.body).toContain('Longsword;ref, error\r\n');
    const standard = sent();
    await controller().fullCsv('e', { csv: 'standard' }, REQ, standard.reply);
    expect(standard.out.body).toContain('Longsword,"ref, error"\r\n');
  });
});
