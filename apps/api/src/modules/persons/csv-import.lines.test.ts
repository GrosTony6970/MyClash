import { describe, it, expect } from 'vitest';
import { EVENT_IMPORT_COLUMNS } from './csv-columns';
import { CsvImportService } from './csv-import.service';

/**
 * The line each imported row is named by. The header is line 1. A blank line moves every row
 * under it, and a quoted cell over two lines puts the next row two lines down: the organiser
 * reads the number in her spreadsheet, so it must be the file's own line.
 */
describe('CsvImportService.parse: the line of each row', () => {
  const service = new CsvImportService();
  const parse = (csv: string) => service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);

  it("gives each row the file's own line", () => {
    const result = parse('given_name,family_name\n\nAda,Lovelace\n"Multi\nline",Smith\n\n,Jones\n');
    expect(result.rows.map((r) => [r.index, r.line, r.family_name])).toEqual([
      [0, 3, 'Lovelace'],
      [1, 4, 'Smith'],
    ]);
    expect(result.invalid.map((r) => [r.index, r.line, r.reason])).toEqual([
      [2, 7, 'missing_given_name'],
    ]);
  });

  it("counts a Windows file's lines the same way", () => {
    const result = parse('given_name,family_name\r\n\r\nAda,Lovelace\r\nBob,Jones\r\n');
    expect(result.rows.map((r) => r.line)).toEqual([3, 4]);
  });

  // csv-parse counted the CR and the LF of a break inside a quoted cell as two lines: the
  // cell's own row and every row after it were named one line too low.
  it('counts a Windows break inside a quoted cell as one line', () => {
    const result = parse('given_name,family_name\r\n"Multi\r\nline",Smith\r\nAda,Lovelace\r\n');
    expect(result.rows.map((r) => [r.line, r.family_name])).toEqual([
      [2, 'Smith'],
      [4, 'Lovelace'],
    ]);
  });

  it('reads a break of a lone CR, as an old Mac file writes it', () => {
    const result = parse('given_name,family_name\rAda,Lovelace\rBob,Jones\r');
    expect(result.rows.map((r) => [r.line, r.family_name])).toEqual([
      [2, 'Lovelace'],
      [3, 'Jones'],
    ]);
  });

  // csv-parse names the LAST line for a quote never closed; the stray `"` is on line 3.
  it('refuses a file with a quote left open, at the line where the quote opens', () => {
    const result = parse('given_name,family_name\nAda,Lovelace\n"Bob,Jones\nCyd,Moss\nDee,Hill\n');
    expect(result.rows).toEqual([]);
    expect(result.invalid).toEqual([{ index: 0, line: 3, reason: 'unreadable_file', raw: '' }]);
  });

  it('refuses another unreadable file at the line csv-parse names', () => {
    // A stray quote further down is not where this file stopped.
    const result = parse(
      'given_name,family_name\nAda,Lovelace\nBob,"Jo"nes\nCyd,Moss\nDee,O"Hill\n',
    );
    expect(result.invalid).toEqual([{ index: 0, line: 3, reason: 'unreadable_file', raw: '' }]);
  });

  // An escaped quote ("") on a later line of the open cell does not move where it opened.
  it('finds the open quote of a cell over several lines that holds an escaped quote', () => {
    const result = parse('given_name,family_name\n"Ann\nO""Neil,Smith\nBob,Jones\n');
    expect(result.invalid).toEqual([{ index: 0, line: 2, reason: 'unreadable_file', raw: '' }]);
  });

  it('counts a line of spaces as the blank line it is', () => {
    const result = parse('given_name,family_name\n   \nAda,Lovelace\n');
    expect(result.rows.map((r) => r.line)).toEqual([3]);
  });
});
