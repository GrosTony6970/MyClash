import { describe, expect, it } from 'vitest';
import { csvRow, escapeCsvCell, escapeCsvField, toCsvCell } from './csv';

describe('escapeCsvField (RFC 4180 only)', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('leaves a plain value untouched', () => {
    expect(escapeCsvField('Jean Dupont')).toBe('Jean Dupont');
  });

  it('does NOT neutralise formulas — that is the point of the split', () => {
    // Machine-ingested feeds must keep their bytes exactly; HEMA Ratings' own
    // importer reads the file we send it.
    expect(escapeCsvField('=SUM(A1)')).toBe('=SUM(A1)');
  });
});

describe('escapeCsvCell (human-facing)', () => {
  it('neutralises every spreadsheet formula lead', () => {
    for (const lead of ['=', '+', '-', '@']) {
      expect(escapeCsvCell(`${lead}cmd|' /c calc'!A1`), lead).toBe(`"'${lead}cmd|' /c calc'!A1"`);
    }
  });

  it('neutralises tab and carriage-return leads too', () => {
    // Both are used to sneak past a naive `startsWith('=')` check.
    expect(escapeCsvCell('\t=1+1')).toContain("'\t=1+1");
    expect(escapeCsvCell('\r=1+1')).toContain("'\r=1+1");
  });

  it('still applies RFC 4180 quoting', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('leaves plain negative numbers numeric so columns still sum', () => {
    // These exports are full of legitimately negative values — score deltas,
    // compensation adjustments. Neutralising them would break the first thing
    // an organiser does with the file.
    expect(escapeCsvCell('-5')).toBe('-5');
    expect(escapeCsvCell('+12')).toBe('+12');
    expect(escapeCsvCell('-3.75')).toBe('-3.75');
  });

  it('still neutralises something that only starts like a number', () => {
    expect(escapeCsvCell('-1+1+cmd|calc')).toBe('"\'-1+1+cmd|calc"');
    expect(escapeCsvCell('-5=SUM(A1)')).toBe('"\'-5=SUM(A1)"');
  });

  it('does not touch a value that merely contains a formula character', () => {
    expect(escapeCsvCell('Sabre A=B')).toBe('Sabre A=B');
  });
});

describe('toCsvCell', () => {
  it('renders null and undefined as empty', () => {
    expect(toCsvCell(null)).toBe('');
    expect(toCsvCell(undefined)).toBe('');
  });

  it('serialises objects as JSON rather than [object Object]', () => {
    expect(toCsvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('keeps 0 and false rather than blanking them', () => {
    expect(toCsvCell(0)).toBe('0');
    expect(toCsvCell(false)).toBe('false');
  });
});

describe('csvRow', () => {
  it('joins values into one safe row', () => {
    expect(csvRow(['a', 'b,c', null, '=X'])).toBe('a,"b,c",,"\'=X"');
  });
});
