import { describe, it, expect } from 'vitest';
import {
  rankingToCsv,
  rankingToPrintHtml,
  type ExportRow,
  type RankingHeaders,
} from './final-ranking-export';

const HEADERS: RankingHeaders = ['Rang', 'Combattant', 'Club', 'Résultat', 'Score de poule'];

const ROWS: ExportRow[] = [
  { rank: 1, fighter: 'Emilie Ave', club: 'ECS', result: 'Champion', poolScore: '4.00' },
  { rank: 2, fighter: 'Jean, le "Fort"', club: '', result: 'Runner-up', poolScore: '3.00' },
  { rank: 9, fighter: 'Zoé', club: 'CEH', result: 'Pools', poolScore: '' },
];

describe('rankingToCsv', () => {
  it('emits the BOM, the given header + one CRLF-separated row each, escaping commas/quotes', () => {
    const csv = rankingToCsv(ROWS, HEADERS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Rang,Combattant,Club,Résultat,Score de poule');
    expect(lines[1]).toBe('1,Emilie Ave,ECS,Champion,4.00');
    // Comma + quotes in the name force quoting with doubled quotes.
    expect(lines[2]).toBe('2,"Jean, le ""Fort""",,Runner-up,3.00');
    expect(lines[3]).toBe('9,Zoé,CEH,Pools,');
  });

  it('emits header only for an empty ranking', () => {
    expect(rankingToCsv([], HEADERS)).toBe(
      '\uFEFFRang,Combattant,Club,Résultat,Score de poule\r\n',
    );
  });

  it('neutralises a spreadsheet formula planted in a fighter or club name', () => {
    // Names come from the roster, which organisers type and import from CSV, so
    // this file can carry a payload straight into whoever opens it.
    const csv = rankingToCsv(
      [{ rank: 1, fighter: '=cmd|calc', club: '@SUM(A1)', result: 'Champion', poolScore: '4.00' }],
      HEADERS,
    );
    expect(csv).toContain('"\'=cmd|calc"');
    expect(csv).toContain('"\'@SUM(A1)"');
  });

  it('keeps a plain pool score numeric so the column still sums', () => {
    const csv = rankingToCsv(
      [{ rank: 3, fighter: 'A', club: 'C', result: 'Pools', poolScore: '-1.50' }],
      HEADERS,
    );
    expect(csv).toContain(',-1.50');
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
});
