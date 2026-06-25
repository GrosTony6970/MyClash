import { describe, it, expect } from 'vitest';
import { rankingToCsv, rankingToPrintHtml, type ExportRow } from './final-ranking-export';

const ROWS: ExportRow[] = [
  { rank: 1, fighter: 'Emilie Ave', club: 'ECS', result: 'Champion', poolScore: '4.00' },
  { rank: 2, fighter: 'Jean, le "Fort"', club: '', result: 'Runner-up', poolScore: '3.00' },
  { rank: 9, fighter: 'Zoé', club: 'CEH', result: 'Pools', poolScore: '' },
];

describe('rankingToCsv', () => {
  it('emits a header + one CRLF-separated row each, escaping commas/quotes', () => {
    const csv = rankingToCsv(ROWS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Rank,Fighter,Club,Result,Pool score');
    expect(lines[1]).toBe('1,Emilie Ave,ECS,Champion,4.00');
    // Comma + quotes in the name force quoting with doubled quotes.
    expect(lines[2]).toBe('2,"Jean, le ""Fort""",,Runner-up,3.00');
    expect(lines[3]).toBe('9,Zoé,CEH,Pools,');
  });

  it('emits header only for an empty ranking', () => {
    expect(rankingToCsv([])).toBe('Rank,Fighter,Club,Result,Pool score');
  });
});

describe('rankingToPrintHtml', () => {
  it('escapes HTML in the title + names and includes every row', () => {
    const rows: ExportRow[] = [
      { rank: 1, fighter: 'A <b> & "x"', club: 'C', result: 'Champion', poolScore: '4.00' },
      { rank: 2, fighter: 'B', club: '', result: 'Pools', poolScore: '' },
    ];
    const html = rankingToPrintHtml('Final <ranking>', rows);
    expect(html).toContain('<title>Final &lt;ranking&gt;</title>');
    expect(html).toContain('A &lt;b&gt; &amp; "x"');
    // One header row + one row per entry.
    expect(html.match(/<tr>/g)?.length).toBe(rows.length + 1);
  });
});
