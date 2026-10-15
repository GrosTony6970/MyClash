import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSV_STANDARD, csvFile } from '@myclash/types';
import { downloadCsv } from './csv-file';

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

    downloadCsv('standings.csv', csvFile([['Rang']], CSV_STANDARD));

    expect(clicked).toEqual(['standings.csv']);
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
