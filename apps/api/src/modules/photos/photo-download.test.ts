import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import { describe, expect, it, vi } from 'vitest';
import type { ZipStreamEntry } from '../../common/stored-zip';
import { photoEntries, photoFileName, photosCsv, type DownloadRow } from './photo-download';
import { downloadRow, heldStore, settle } from './testing/download-doubles';

const PARIS = 'Europe/Paris';
const jpeg = (n: number) => Buffer.from(`jpeg-${n}`);

async function all(entries: AsyncIterable<ZipStreamEntry>): Promise<ZipStreamEntry[]> {
  const out: ZipStreamEntry[] = [];
  for await (const entry of entries) out.push(entry);
  return out;
}

function entriesOf(rows: DownloadRow[], answers: Record<string, Buffer | null | Error>) {
  const held = heldStore(answers, { auto: true });
  const warn = vi.fn();
  const entries = photoEntries(
    rows,
    held.store,
    PARIS,
    CSV_STANDARD,
    warn,
    new AbortController().signal,
  );
  return { entries, warn, held };
}

describe('photoFileName', () => {
  const row = downloadRow(1, jpeg(1), {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    created_at: '2026-11-01T13:03:00.123456+00:00',
  });

  it('names a photo by when it was sent, on the Event clock, and its short id', () => {
    expect(photoFileName(row, PARIS)).toBe('2026-11-01_14-03_aaaaaaaa.jpg');
    expect(photoFileName(row, 'America/New_York')).toBe('2026-11-01_08-03_aaaaaaaa.jpg');
  });

  it('refuses a time it cannot read rather than naming the file by nothing', () => {
    expect(() => photoFileName({ ...row, created_at: 'yesterday' }, PARIS)).toThrow(
      'unreadable time',
    );
  });
});

describe('photosCsv', () => {
  const rows = [
    downloadRow(1, jpeg(1), {
      uploader_name: 'Géraldine',
      caption: '=HYPERLINK("x")',
      tournament: { name: 'Longsword Open' },
      created_at: '2026-11-01T13:03:00+00:00',
      status: 'waiting',
    }),
    downloadRow(2, jpeg(2), {
      uploader_name: 'a,"b"\nc',
      caption: null,
      workshop: { title: 'Rapier basics' },
    }),
    downloadRow(3, jpeg(3), { uploader_name: null }),
  ];

  it('writes a header and one row per photo, formula-safe, for Excel', () => {
    const text = photosCsv(rows, PARIS, CSV_STANDARD).toString('utf8');
    expect(text.startsWith('﻿file,name,caption,tag,time,status\r\n')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[1]).toBe(
      `${photoFileName(rows[0]!, PARIS)},Géraldine,"'=HYPERLINK(""x"")",Longsword Open,2026-11-01 14:03,waiting`,
    );
    expect(lines[2]).toContain(',"a,""b""\nc",,Rapier basics,');
    expect(lines[3]).toMatch(/^[^,]+,,,,2026-11-01 14:03,approved$/);
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('writes the French Excel format when the organiser picks it', () => {
    const text = photosCsv(rows.slice(2), PARIS, CSV_EXCEL_FR).toString('utf8');
    expect(text).toContain('file;name;caption;tag;time;status\r\n');
  });
});

describe('photoEntries', () => {
  const rows = [1, 2, 3].map((n) => downloadRow(n, jpeg(n)));
  const stored = Object.fromEntries(rows.map((r, i) => [r.original_key, jpeg(i + 1)]));

  it('yields each stored original, its checked CRC and time, then photos.csv last', async () => {
    const { entries } = entriesOf(rows, stored);
    const out = await all(entries);
    expect(out.map((e) => e.name)).toEqual([
      ...rows.map((r) => photoFileName(r, PARIS)),
      'photos.csv',
    ]);
    expect(out[0]!.bytes).toEqual(jpeg(1));
    expect(out[0]!.crc32).toBe(rows[0]!.crc32);
    expect(out[0]!.modifiedAt).toEqual({ day: '2026-11-01', hhmm: '14:01' });
    expect(out[3]!.bytes.toString('utf8').split('\r\n')).toHaveLength(5);
  });

  it('leaves out a photo whose image is gone, says which, and lists only what is in the zip', async () => {
    const { entries, warn } = entriesOf(rows, { ...stored, [rows[1]!.original_key]: null });
    const out = await all(entries);
    expect(out.map((e) => e.name)).not.toContain(photoFileName(rows[1]!, PARIS));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rows[1]!.id));
    const csv = out.at(-1)!.bytes.toString('utf8');
    expect(csv).not.toContain(photoFileName(rows[1]!, PARIS));
    expect(csv).toContain(photoFileName(rows[2]!, PARIS));
  });

  it('leaves out a photo whose bytes differ from its stored size or CRC', async () => {
    const { entries, warn } = entriesOf(rows, {
      ...stored,
      [rows[0]!.original_key]: Buffer.from('jpeg-1-longer'),
      [rows[2]!.original_key]: Buffer.from('jpeg-9'),
    });
    const out = await all(entries);
    expect(out.map((e) => e.name)).toEqual([photoFileName(rows[1]!, PARIS), 'photos.csv']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('leaves out a photo of the right CRC whose length is not the stored size', async () => {
    const short = [downloadRow(1, jpeg(1), { byte_size: jpeg(1).length + 1 })];
    const { entries, warn } = entriesOf(short, { [short[0]!.original_key]: jpeg(1) });
    expect((await all(entries)).map((e) => e.name)).toEqual(['photos.csv']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ends with the bucket error when a read fails', async () => {
    const failure = new Error('Photo bucket answered HTTP 500 (InternalError)');
    const { entries } = entriesOf(rows, { ...stored, [rows[1]!.original_key]: failure });
    await expect(all(entries)).rejects.toThrow('HTTP 500');
  });

  it('reads one photo ahead of its reader, never more', async () => {
    const held = heldStore(stored);
    const entries = photoEntries(
      rows,
      held.store,
      PARIS,
      CSV_STANDARD,
      vi.fn(),
      new AbortController().signal,
    );
    const first = entries.next();
    await settle();
    expect(held.started).toHaveLength(1);
    held.releaseNext();
    await first;
    await settle();
    expect(held.started).toHaveLength(2);
    await settle();
    expect(held.started).toHaveLength(2);
    const second = entries.next();
    held.releaseNext();
    await second;
    await settle();
    expect(held.started).toHaveLength(3);
    await entries.return(undefined);
  });

  it('stops reading when the download is closed, even with a read under way', async () => {
    const held = heldStore(stored);
    const stop = new AbortController();
    const entries = photoEntries(rows, held.store, PARIS, CSV_STANDARD, vi.fn(), stop.signal);
    const first = entries.next();
    held.releaseNext();
    await first;
    const second = entries.next();
    await settle();
    expect(held.started).toHaveLength(2);
    stop.abort();
    const closing = entries.return(undefined);
    held.releaseNext();
    await second;
    await closing;
    await settle();
    expect(held.started).toHaveLength(2);
  });

  it('once closed, ends at once: no further entry, no false "image gone", no csv', async () => {
    const held = heldStore(stored, { auto: true });
    const stop = new AbortController();
    const warn = vi.fn();
    const entries = photoEntries(rows, held.store, PARIS, CSV_STANDARD, warn, stop.signal);
    await entries.next();
    stop.abort();
    const rest = await all(entries);
    expect(rest).toEqual([]);
    expect(held.started).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('holds a read that fails while its reader is busy, and hands the error over when asked', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const failure = new Error('Photo bucket did not answer within 30000 ms (read)');
      const held = heldStore({ ...stored, [rows[1]!.original_key]: failure });
      const entries = photoEntries(
        rows,
        held.store,
        PARIS,
        CSV_STANDARD,
        vi.fn(),
        new AbortController().signal,
      );
      const first = entries.next();
      held.releaseNext();
      await first;
      held.releaseNext();
      await settle();
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      await expect(entries.next()).rejects.toThrow('did not answer');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
