import { describe, expect, it } from 'vitest';
import { CsvDownloadQueryDto, csvDownload } from './csv-download';

/**
 * A CSV download of the server asks which file (operator, 2026-10-15): French Excel splits on `;`
 * and reads `12,50` as a number. Both files start with the byte-order mark, so Excel reads accents.
 */
const schema = CsvDownloadQueryDto.schema;
const ROWS = [
  ['fighter', 'double_hit_average'],
  ['Léa, Martin', '1.5'],
];

describe('the CSV download query', () => {
  it('names no file: the standard one, so a link made before the choice keeps its file', () => {
    expect(schema.parse({})).toEqual({ csv: 'standard' });
  });

  it('takes the two names, and refuses any other', () => {
    expect(schema.parse({ csv: 'excel-fr' })).toEqual({ csv: 'excel-fr' });
    expect(schema.parse({ csv: 'standard' })).toEqual({ csv: 'standard' });
    expect(schema.safeParse({ csv: 'excel' }).success).toBe(false);
    expect(schema.safeParse({ csv: 'standard', format: 'zip' }).success).toBe(false);
  });
});

describe('csvDownload', () => {
  it('writes the French Excel file: ;, a decimal comma, the byte-order mark, CRLF', () => {
    expect(csvDownload(ROWS, { csv: 'excel-fr' })).toBe(
      '\uFEFFfighter;double_hit_average\r\nLéa, Martin;1,5\r\n',
    );
  });

  it('writes the standard file: ,, a decimal point, the byte-order mark, CRLF', () => {
    expect(csvDownload(ROWS, { csv: 'standard' })).toBe(
      '\uFEFFfighter,double_hit_average\r\n"Léa, Martin",1.5\r\n',
    );
  });
});
