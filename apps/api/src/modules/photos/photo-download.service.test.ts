import { Writable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { CSV_STANDARD } from '@myclash/types';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { readZip } from '../../common/testing/zip-reader';
import type { PhotoStore } from './photo-bucket';
import { photoFileName, type DownloadRow } from './photo-download';
import { PhotoDownloadService } from './photo-download.service';
import type { PhotoEventRow } from './photo-organiser';
import { downloadRow, heldStore, settle } from './testing/download-doubles';

const EVENT: PhotoEventRow = {
  id: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
  organization_id: 'org-1',
  slug: 'fal-2026',
  name: 'FAL 2026',
  start_date: '2026-11-01',
  end_date: '2026-11-02',
  timezone: 'Europe/Paris',
  photo_mode: 'live',
  photo_token_version: 1,
};
/** 00:00 on 3 December 2026, Paris: 30 days after the last day. */
const DELETES_AT = Date.parse('2026-12-02T23:00:00.000Z');
const SELECT =
  'id, status, uploader_name, caption, created_at, original_key, byte_size, crc32, tournament:tournaments(name), workshop:workshops(title)';

const jpeg = (n: number) => Buffer.from(`jpeg-${n}`);
const onEvent = (row: DownloadRow): SupabaseRow => ({
  ...row,
  event_id: EVENT.id,
  tournament_id: null,
});

function service(rows: SupabaseRow[], store: PhotoStore | null, now = DELETES_AT - 1) {
  const supabase = mockSupabase({ event_photos: { rows } });
  const downloads = new PhotoDownloadService(supabase as never, store);
  downloads.now = () => new Date(now);
  return { downloads, from: supabase.from };
}

async function drain(body: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const storeOf = (rows: DownloadRow[], bytes: (n: number) => Buffer = jpeg) =>
  heldStore(Object.fromEntries(rows.map((r, i) => [r.original_key, bytes(i + 1)])), { auto: true });

describe('PhotoDownloadService.zip — the gates', () => {
  const rows = [downloadRow(1, jpeg(1))];

  it('says photos are unavailable when no bucket is set up, before reading a row', async () => {
    const { downloads, from } = service(rows.map(onEvent), null);
    await expect(downloads.zip(EVENT, {}, CSV_STANDARD)).rejects.toMatchObject({
      response: { code: 'photos_unavailable' },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('answers Gone from the deletion instant on, and a zip just before it', async () => {
    const store = storeOf(rows).store;
    const gone = service(rows.map(onEvent), store, DELETES_AT).downloads;
    await expect(gone.zip(EVENT, {}, CSV_STANDARD)).rejects.toMatchObject({ status: 410 });
    const open = service(rows.map(onEvent), store, DELETES_AT - 1).downloads;
    await expect(open.zip(EVENT, {}, CSV_STANDARD)).resolves.toMatchObject({
      filename: 'fal-2026-photos.zip',
    });
  });

  it('gives a zip when the end date cannot be read (nothing says the photos are gone)', async () => {
    const { downloads } = service(rows.map(onEvent), storeOf(rows).store, DELETES_AT + 1e10);
    await expect(
      downloads.zip({ ...EVENT, end_date: null }, {}, CSV_STANDARD),
    ).resolves.toBeTruthy();
  });
});

describe('PhotoDownloadService.zip — the rows', () => {
  it('reads every row of the Event by id, 1,000 a page, before the first byte', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => downloadRow(i + 1, jpeg(i + 1)));
    const { downloads, from } = service(rows.map(onEvent), storeOf(rows).store);
    await downloads.zip(EVENT, {}, CSV_STANDARD);

    expect(selectsFor(from, 'event_photos')).toEqual([SELECT, SELECT]);
    expect(filtersFor(from, 'event_photos', 'eq')).toEqual([
      ['event_id', EVENT.id],
      ['event_id', EVENT.id],
    ]);
    expect(filtersFor(from, 'event_photos', 'order')).toEqual([
      ['id', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(filtersFor(from, 'event_photos', 'limit')).toEqual([[1000], [1000]]);
    expect(filtersFor(from, 'event_photos', 'gt')).toEqual([['id', rows[999]!.id]]);
  });

  it('reads one page when it holds fewer than 1,000 rows', async () => {
    const rows = Array.from({ length: 999 }, (_, i) => downloadRow(i + 1, jpeg(i + 1)));
    const { downloads, from } = service(rows.map(onEvent), storeOf(rows).store);
    await downloads.zip(EVENT, {}, CSV_STANDARD);
    expect(selectsFor(from, 'event_photos')).toHaveLength(1);
  });

  it('keeps photos sent at the same instant on both sides of a page, in time order', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      downloadRow(i + 1, jpeg(i + 1), {
        created_at: i >= 998 ? '2026-11-01T12:00:00+00:00' : '2026-11-01T13:00:00+00:00',
      }),
    );
    const { downloads } = service(rows.map(onEvent), storeOf(rows).store);
    const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
    const names = readZip(await drain(body)).entries.map((e) => e.name);
    expect(names).toHaveLength(1002);
    expect(names.slice(0, 3)).toEqual(rows.slice(998).map((r) => photoFileName(r, 'Europe/Paris')));
  });

  it('narrows to one Tournament or one Workshop', async () => {
    const t = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rows = [1, 2].map((n) => downloadRow(n, jpeg(n)));
    const seeded = [
      { ...onEvent(rows[0]!), tournament_id: t },
      { ...onEvent(rows[1]!), workshop_id: t },
    ];
    const byTournament = service(seeded, storeOf(rows).store);
    const zipped = await byTournament.downloads.zip(EVENT, { tournamentId: t }, CSV_STANDARD);
    expect(readZip(await drain(zipped.body)).entries.map((e) => e.name)).toEqual([
      photoFileName(rows[0]!, 'Europe/Paris'),
      'photos.csv',
    ]);
    expect(filtersFor(byTournament.from, 'event_photos', 'eq')).toContainEqual([
      'tournament_id',
      t,
    ]);

    const byWorkshop = service(seeded, storeOf(rows).store);
    await byWorkshop.downloads.zip(EVENT, { workshopId: t }, CSV_STANDARD);
    expect(filtersFor(byWorkshop.from, 'event_photos', 'eq')).toContainEqual(['workshop_id', t]);
  });

  it('fails before any byte when a row read fails, and reads no image', async () => {
    const supabase = mockSupabase({
      event_photos: { data: null, error: { message: 'connection reset' } },
    });
    const held = heldStore({}, { auto: true });
    const downloads = new PhotoDownloadService(supabase as never, held.store);
    downloads.now = () => new Date(DELETES_AT - 1);
    await expect(downloads.zip(EVENT, {}, CSV_STANDARD)).rejects.toThrow('connection reset');
    expect(held.started).toEqual([]);
  });
});

describe('PhotoDownloadService.zip — the stream', () => {
  const rows = [1, 2, 3].map((n) => downloadRow(n, jpeg(n), { caption: `caption ${n}` }));

  it('streams the stored originals and a csv of them, as a zip a reader reads', async () => {
    const { downloads } = service(rows.map(onEvent), storeOf(rows).store);
    const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
    const zip = readZip(await drain(body));
    expect(zip.entries.slice(0, 3).map((e) => e.data)).toEqual([jpeg(1), jpeg(2), jpeg(3)]);
    const csv = zip.entries[3]!.data!.toString('utf8');
    expect(csv).toContain(`${photoFileName(rows[2]!, 'Europe/Paris')},Sender 3,caption 3,`);
  });

  it('says photos are unavailable when the first image read fails, before the answer starts', async () => {
    const held = heldStore({ [rows[0]!.original_key]: new Error('HTTP 403') }, { auto: true });
    const { downloads } = service(rows.map(onEvent), held.store);
    await expect(downloads.zip(EVENT, {}, CSV_STANDARD)).rejects.toMatchObject({
      response: { code: 'photos_unavailable' },
    });
  });

  it('fails the stream, never ends it cleanly, when the bucket fails after the first photo', async () => {
    const failure = new Error('Photo bucket answered HTTP 500 (InternalError)');
    const held = heldStore(
      { [rows[0]!.original_key]: jpeg(1), [rows[1]!.original_key]: failure },
      { auto: true },
    );
    const { downloads } = service(rows.map(onEvent), held.store);
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
      await expect(drain(body)).rejects.toThrow('HTTP 500');
      // The browser only sees a failed download: the log says which Event, and why.
      expect(logged).toHaveBeenCalledWith(
        `Event ${EVENT.id}: the photo download failed after it started`,
        failure,
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('skips a first photo gone from the bucket before the answer starts', async () => {
    const held = heldStore(
      {
        [rows[0]!.original_key]: null,
        [rows[1]!.original_key]: jpeg(2),
        [rows[2]!.original_key]: jpeg(3),
      },
      { auto: true },
    );
    const { downloads } = service(rows.map(onEvent), held.store);
    const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
    expect(readZip(await drain(body)).entries).toHaveLength(3);
  });

  it('stops reading the bucket once the download is closed, a read under way included', async () => {
    const held = heldStore(Object.fromEntries(rows.map((r, i) => [r.original_key, jpeg(i + 1)])));
    const { downloads } = service(rows.map(onEvent), held.store);
    const zipping = downloads.zip(EVENT, {}, CSV_STANDARD);
    await settle();
    held.releaseNext();
    const { body } = await zipping;
    // Flowing, as Fastify reads it: the source then waits on photo 2's read when the organiser
    // leaves, so its return() queues behind that read.
    body.on('data', () => {});
    await settle();
    expect(held.started).toHaveLength(2);
    body.destroy();
    await settle();
    held.releaseNext();
    await settle();
    await settle();
    expect(held.started).toHaveLength(2);
  });

  it('a paused reader stops the bucket reads', async () => {
    const many = Array.from({ length: 10 }, (_, i) => downloadRow(i + 1, jpeg(i + 1)));
    const store = storeOf(many);
    const { downloads } = service(many.map(onEvent), store.store);
    const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
    await new Promise<void>((resolve) => body.once('data', () => resolve()));
    body.pause();
    await settle();
    await settle();
    expect(store.started.length).toBeLessThanOrEqual(3);
    body.destroy();
  });
});

describe('PhotoDownloadService.zip — memory (design: 1 GiB streamed, memory flat)', () => {
  // The originals live outside the JS heap, so a heapUsed bound could not fail here: the hold is
  // the count of originals read and not yet written.
  it('streams 1 GiB holding at most three originals at once, the first byte after two reads', async () => {
    const size = 12 * 1024 * 1024;
    const crc = crc32(Buffer.alloc(size));
    const rows = Array.from({ length: 86 }, (_, i) =>
      downloadRow(i + 1, Buffer.alloc(0), { byte_size: size, crc32: crc }),
    );
    const live = new Set<Buffer>();
    let most = 0;
    let started = 0;
    const store = {
      ...heldStore({}).store,
      get: async () => {
        started += 1;
        const bytes = Buffer.alloc(size);
        live.add(bytes);
        most = Math.max(most, live.size);
        return bytes;
      },
    } satisfies PhotoStore;
    const { downloads } = service(rows.map(onEvent), store);
    let startedAtFirstChunk = -1;
    const sink = new Writable({
      highWaterMark: 64 * 1024,
      write(chunk: Buffer, _encoding, done) {
        if (startedAtFirstChunk < 0) startedAtFirstChunk = started;
        live.delete(chunk);
        setImmediate(done);
      },
    });
    const { body } = await downloads.zip(EVENT, {}, CSV_STANDARD);
    await new Promise<void>((resolve, reject) => {
      body.pipe(sink).on('finish', resolve).on('error', reject);
    });

    expect(started).toBe(86);
    expect(startedAtFirstChunk).toBeLessThanOrEqual(2);
    expect(most).toBeLessThanOrEqual(3);
  }, 60_000);
});
