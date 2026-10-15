import { describe, expect, it } from 'vitest';
import {
  CSV_EXCEL_FR,
  CSV_FORMAT_PARAMS,
  CSV_STANDARD,
  csvFile,
  csvFormatFromParam,
  csvFormatParam,
  csvRow,
  escapeCsvCell,
  escapeCsvField,
  toCsvCell,
} from './csv';

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

describe('the two formats', () => {
  // Every API CSV reads CSV_STANDARD: a write to it anywhere would change them all.
  it('cannot be changed', () => {
    expect(Object.isFrozen(CSV_STANDARD)).toBe(true);
    expect(Object.isFrozen(CSV_EXCEL_FR)).toBe(true);
  });
});

describe('the escapers handed to map', () => {
  // `map` passes the index as a second argument: an escaper that read one as its separator
  // stopped quoting the commas of the HEMA Ratings feed (`row.map(escapeCsvField)`).
  it('quote the same as when called with one value', () => {
    const values = ['Dupont, Jean', 'a', '=X'];
    expect(values.map(escapeCsvField)).toEqual(['"Dupont, Jean"', 'a', '=X']);
    expect(values.map(escapeCsvCell)).toEqual(['"Dupont, Jean"', 'a', '"\'=X"']);
    expect([...values, null].map(toCsvCell)).toEqual(['"Dupont, Jean"', 'a', '"\'=X"', '']);
  });
});

describe('csvRow', () => {
  it('joins values into one safe row', () => {
    expect(csvRow(['a', 'b,c', null, '=X'], CSV_STANDARD)).toBe('a,"b,c",,"\'=X"');
  });

  it('keeps the point of a decimal in the standard file', () => {
    expect(csvRow(['12.50', 4.5], CSV_STANDARD)).toBe('12.50,4.5');
  });
});

/**
 * French Excel (operator, 2026-10-15): it splits a row on `;` and reads `12,50` as a number.
 * Given a comma file, every value lands in the first column; given `12.50`, a total of the pay
 * column skips it.
 */
describe('csvRow, French Excel', () => {
  it('splits on ; and writes a decimal with a comma', () => {
    expect(csvRow(['Léa Martin', '12.50', 4.5, '-3.75', 3], CSV_EXCEL_FR)).toBe(
      'Léa Martin;12,50;4,5;-3,75;3',
    );
  });

  it('quotes a cell that holds a ; and leaves a comma of text bare', () => {
    expect(csvRow(['Longsword (Registered); Sabre (Registered)', 'Roux, Ana'], CSV_EXCEL_FR)).toBe(
      '"Longsword (Registered); Sabre (Registered)";Roux, Ana',
    );
  });

  it('touches no value that is not a plain decimal: times, dates, versions, labels', () => {
    expect(csvRow(['09:30', '2026-10-15', '1.0.0', 'LSW-P1-M2', '1.5 pts'], CSV_EXCEL_FR)).toBe(
      '09:30;2026-10-15;1.0.0;LSW-P1-M2;1.5 pts',
    );
  });

  it('still neutralises a formula', () => {
    expect(csvRow(['=SUM(A1)', '-1+1+cmd|calc'], CSV_EXCEL_FR)).toBe(
      '"\'=SUM(A1)";"\'-1+1+cmd|calc"',
    );
  });
});

describe('csvFile', () => {
  it('starts with the byte-order mark, so a spreadsheet reads accents as written', () => {
    expect(csvFile([['Géraldine']], CSV_STANDARD).charCodeAt(0)).toBe(0xfeff);
  });

  it('writes one formula-safe row per line, CRLF, and a last line end', () => {
    expect(
      csvFile(
        [
          ['Name', 'Score'],
          ['=SUM(A1)', 3],
          ['Ana, Roux', null],
        ],
        CSV_STANDARD,
      ),
    ).toBe(`\uFEFFName,Score\r\n"'=SUM(A1)",3\r\n"Ana, Roux",\r\n`);
  });

  it('writes the French Excel file with ; and decimal commas', () => {
    expect(
      csvFile(
        [
          ['Nom', 'Montant'],
          ['Ana, Roux', '12.50'],
        ],
        CSV_EXCEL_FR,
      ),
    ).toBe(`\uFEFFNom;Montant\r\nAna, Roux;12,50\r\n`);
  });
});

describe('the name of a format in a download link', () => {
  it('names each file, and reads each name back', () => {
    expect(csvFormatParam(CSV_EXCEL_FR)).toBe('excel-fr');
    expect(csvFormatParam(CSV_STANDARD)).toBe('standard');
    for (const param of CSV_FORMAT_PARAMS) {
      expect(csvFormatParam(csvFormatFromParam(param))).toBe(param);
    }
    expect(csvFormatFromParam('excel-fr')).toBe(CSV_EXCEL_FR);
    expect(csvFormatFromParam('standard')).toBe(CSV_STANDARD);
  });
});
