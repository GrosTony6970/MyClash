import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvFile, downloadCsv } from './csv-file';

describe('csvFile', () => {
  it('starts with the byte-order mark, so a spreadsheet reads accents as written', () => {
    expect(csvFile([['Géraldine']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('writes one formula-safe row per line, CRLF, and a last line end', () => {
    expect(
      csvFile([
        ['Name', 'Score'],
        ['=SUM(A1)', 3],
        ['Ana, Roux', null],
      ]),
    ).toBe(`\uFEFFName,Score\r\n"'=SUM(A1)",3\r\n"Ana, Roux",\r\n`);
  });
});

describe('downloadCsv', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands the browser a UTF-8 CSV under its file name', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:csv';
      },
      revokeObjectURL: () => undefined,
    });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    downloadCsv('standings.csv', csvFile([['Rang']]));

    expect(clicked).toEqual(['standings.csv']);
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
