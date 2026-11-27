import { describe, it, expect } from 'vitest';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import {
  rankingToCsv,
  rankingToPrintHtml,
  type ExportRow,
  type RankingHeaders,
} from './final-ranking-export';

const HEADERS: RankingHeaders = {
  rank: 'Rang',
  entrant: 'Combattant',
  club: 'Club',
  result: 'Résultat',
  poolScore: 'Score de poule',
};
/** A team ranking's titles: a team has no club, so no Club column. */
const TEAM_HEADERS: RankingHeaders = { ...HEADERS, entrant: 'Équipe', club: null };
const TEAM_ROWS: ExportRow[] = [
  { rank: 1, fighter: 'Lyon Blades', club: '', result: 'Champion', poolScore: '4.00' },
  { rank: 2, fighter: 'Paris Rapiers', club: '', result: 'Runner-up', poolScore: '' },
];

const ROWS: ExportRow[] = [
  { rank: 1, fighter: 'Emilie Ave', club: 'ECS', result: 'Champion', poolScore: '4.00' },
  { rank: 2, fighter: 'Jean, le "Fort"', club: '', result: 'Runner-up', poolScore: '3.00' },
  { rank: 9, fighter: 'Zoé', club: 'CEH', result: 'Pools', poolScore: '' },
];

describe('rankingToCsv', () => {
  it('emits the BOM, the given header + one CRLF-separated row each, escaping commas/quotes', () => {
    const csv = rankingToCsv(ROWS, HEADERS, CSV_STANDARD);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Rang,Combattant,Club,Résultat,Score de poule');
    expect(lines[1]).toBe('1,Emilie Ave,ECS,Champion,4.00');
    // Comma + quotes in the name force quoting with doubled quotes.
    expect(lines[2]).toBe('2,"Jean, le ""Fort""",,Runner-up,3.00');
    expect(lines[3]).toBe('9,Zoé,CEH,Pools,');
  });

  it('emits header only for an empty ranking', () => {
    expect(rankingToCsv([], HEADERS, CSV_STANDARD)).toBe(
      '\uFEFFRang,Combattant,Club,Résultat,Score de poule\r\n',
    );
  });

  it('neutralises a spreadsheet formula planted in a fighter or club name', () => {
    // Names come from the roster, which organisers type and import from CSV, so
    // this file can carry a payload straight into whoever opens it.
    const csv = rankingToCsv(
      [{ rank: 1, fighter: '=cmd|calc', club: '@SUM(A1)', result: 'Champion', poolScore: '4.00' }],
      HEADERS,
      CSV_STANDARD,
    );
    expect(csv).toContain('"\'=cmd|calc"');
    expect(csv).toContain('"\'@SUM(A1)"');
  });

  it('keeps a plain pool score numeric so the column still sums', () => {
    const csv = rankingToCsv(
      [{ rank: 3, fighter: 'A', club: 'C', result: 'Pools', poolScore: '-1.50' }],
      HEADERS,
      CSV_STANDARD,
    );
    expect(csv).toContain(',-1.50');
  });

  it('for French Excel, writes the pool score as -1,50 between ;', () => {
    const csv = rankingToCsv(
      [{ rank: 3, fighter: 'A', club: 'C', result: 'Pools', poolScore: '-1.50' }],
      HEADERS,
      CSV_EXCEL_FR,
    );
    expect(csv.slice(1).split('\r\n')[1]).toBe('3;A;C;Pools;-1,50');
  });

  it('a team ranking has no Club column', () => {
    const lines = rankingToCsv(TEAM_ROWS, TEAM_HEADERS, CSV_STANDARD).slice(1).split('\r\n');
    expect(lines[0]).toBe('Rang,Équipe,Résultat,Score de poule');
    expect(lines[1]).toBe('1,Lyon Blades,Champion,4.00');
    expect(lines[2]).toBe('2,Paris Rapiers,Runner-up,');
  });
});

describe('rankingToPrintHtml', () => {
  it('escapes HTML in the title + names and includes every row', () => {
    const rows: ExportRow[] = [
      { rank: 1, fighter: 'A <b> & "x"', club: 'C', result: 'Champion', poolScore: '4.00' },
      { rank: 2, fighter: 'B', club: '', result: 'Pools', poolScore: '' },
    ];
    const html = rankingToPrintHtml('Final <ranking>', rows, HEADERS);
    expect(html).toContain('<th>Score de poule</th>');
    expect(html).toContain('<title>Final &lt;ranking&gt;</title>');
    // Quotes escape too — the shared escaper is attribute-safe, so a name can
    // be dropped into a title="…" without breaking out of it.
    expect(html).toContain('A &lt;b&gt; &amp; &quot;x&quot;');
    // One header row + one row per entry.
    expect(html.match(/<tr>/g)?.length).toBe(rows.length + 1);
  });

  it('prints each column in order, the rank and the pool score right-aligned', () => {
    const html = rankingToPrintHtml('Final', ROWS.slice(0, 1), HEADERS);
    expect(html).toContain(
      '<thead><tr><th>Rang</th><th>Combattant</th><th>Club</th><th>Résultat</th><th>Score de poule</th></tr></thead>',
    );
    expect(html).toContain(
      '<tbody><tr><td class="r">1</td><td>Emilie Ave</td><td>ECS</td><td>Champion</td><td class="r">4.00</td></tr></tbody>',
    );
  });

  it('prints a team ranking with no Club column', () => {
    const html = rankingToPrintHtml('Final', TEAM_ROWS.slice(0, 1), TEAM_HEADERS);
    expect(html).toContain(
      '<thead><tr><th>Rang</th><th>Équipe</th><th>Résultat</th><th>Score de poule</th></tr></thead>',
    );
    expect(html).toContain(
      '<tbody><tr><td class="r">1</td><td>Lyon Blades</td><td>Champion</td><td class="r">4.00</td></tr></tbody>',
    );
  });
});
