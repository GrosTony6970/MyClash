import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { readZip } from '../../common/testing/zip-reader';
import type { PhotoStore } from './photo-bucket';
import { PhotoDownloadService } from './photo-download.service';
import { PhotosController } from './photos.controller';
import { downloadRow, heldStore } from './testing/download-doubles';

/**
 * The real route, the real download service and the real stream, sent by Fastify over a socket:
 * what the browser gets, and what the bucket is asked, when the organiser stays, leaves, or only
 * asks for the headers. Only the database and the bucket are doubles.
 */

const EVENT = {
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
const jpeg = (n: number) => Buffer.from(`jpeg-${n}`);
const rows = [1, 2, 3].map((n) => downloadRow(n, jpeg(n)));
const stored = Object.fromEntries(rows.map((r, i) => [r.original_key, jpeg(i + 1)]));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function served(store: PhotoStore) {
  const supabase = mockSupabase({
    event_photos: { rows: rows.map((r) => ({ ...r, event_id: EVENT.id })) },
  });
  const downloads = new PhotoDownloadService(supabase as never, store);
  downloads.now = () => new Date('2026-11-06T12:00:00Z');
  const zip = vi.spyOn(downloads, 'zip');
  const moderation = { eventForOrganiser: vi.fn(async () => EVENT) };
  const auth = { getAuthUser: vi.fn(async () => ({ id: 'user-7' })) };
  const ctl = new PhotosController(
    {} as never,
    {} as never,
    {} as never,
    { get: () => 'production' } as never,
    auth as never,
    moderation as never,
    {} as never,
    downloads,
  );
  const app = Fastify();
  const req = { cookies: { 'sb-access-token': 'session' }, headers: {} };
  app.get('/zip', (request, reply) =>
    ctl.download(EVENT.id, { csv: 'standard' }, { ...req, method: request.method } as never, reply),
  );
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  close = () => app.close();
  return { url: `${address}/zip`, zip, moderation };
}

describe('the download over a socket', () => {
  it('arrives whole: every photo, then photos.csv', async () => {
    const { url } = await served(heldStore(stored, { auto: true }).store);
    const zip = readZip(Buffer.from(await (await fetch(url)).arrayBuffer()));
    expect(zip.entries.map((e) => e.data)).toEqual([jpeg(1), jpeg(2), jpeg(3), expect.anything()]);
    expect(zip.entries[3]!.name).toBe('photos.csv');
  });

  it('is cut, never finished, when the bucket fails after the first photo', async () => {
    const failing = { ...stored, [rows[1]!.original_key]: new Error('HTTP 500') };
    const { url } = await served(heldStore(failing, { auto: true }).store);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it('reads nothing more from the bucket once the organiser leaves, a read under way included', async () => {
    const held = heldStore(stored);
    const { url } = await served(held.store);
    const leave = new AbortController();
    const answering = fetch(url, { signal: leave.signal });
    await wait(50);
    held.releaseNext();
    await answering;
    await wait(50);
    expect(held.started).toHaveLength(2);
    leave.abort();
    await wait(100);
    held.releaseNext();
    await wait(100);
    expect(held.started).toHaveLength(2);
  });

  it('answers HEAD with the headers only, behind the gate, and reads no photo', async () => {
    const held = heldStore(stored, { auto: true });
    const { url, zip, moderation } = await served(held.store);
    const res = await fetch(url, { method: 'HEAD' });
    await wait(100);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(moderation.eventForOrganiser).toHaveBeenCalledOnce();
    expect(zip).not.toHaveBeenCalled();
    expect(held.started).toEqual([]);
  });
});
