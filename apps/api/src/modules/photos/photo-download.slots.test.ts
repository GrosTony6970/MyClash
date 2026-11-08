import { CSV_STANDARD } from '@myclash/types';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import type { PhotoStore } from './photo-bucket';
import { PhotoDownloadService } from './photo-download.service';
import type { PhotoEventRow } from './photo-organiser';
import { downloadRow, heldStore, settle } from './testing/download-doubles';

/**
 * At most four zips at once (ruling 497): each holds up to ~36 MiB and a bucket connection in the
 * API that also serves scoring. A slot frees on every way a zip ends, an idle reader included.
 */
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
const jpeg = (n: number) => Buffer.from(`jpeg-${n}`);
const rows = Array.from({ length: 3 }, (_, i) => downloadRow(i + 1, jpeg(i + 1)));
const seeded = rows.map((row) => ({ ...row, event_id: EVENT.id, tournament_id: null }));
const auto = () =>
  heldStore(Object.fromEntries(rows.map((r, i) => [r.original_key, jpeg(i + 1)])), { auto: true })
    .store;

function service(store: PhotoStore, table: object = { rows: seeded }) {
  const supabase = mockSupabase({ event_photos: table });
  const downloads = new PhotoDownloadService(supabase as never, store);
  downloads.now = () => new Date('2026-11-05T12:00:00Z');
  return { downloads, from: supabase.from };
}
const zip = (downloads: PhotoDownloadService) => downloads.zip(EVENT, {}, CSV_STANDARD);
/** Opens `count` zips. Each body's error is heard, as Fastify hears it. */
async function open(downloads: PhotoDownloadService, count: number) {
  const zips = [];
  for (let i = 0; i < count; i += 1) {
    const opened = await zip(downloads);
    opened.body.on('error', () => {});
    zips.push(opened);
  }
  return zips;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PhotoDownloadService.zip — the slots (ruling 497)', () => {
  it('refuses a fifth zip while four run, before reading a row, and logs it', async () => {
    const { downloads, from } = service(auto());
    await open(downloads, 4);
    expect(downloads.busy()).toBe(true);
    from.mockClear();
    const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await expect(zip(downloads)).rejects.toMatchObject({
      status: 503,
      response: { code: 'photo_downloads_busy' },
    });
    expect(from).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith(
      `Event ${EVENT.id}: a photo download was refused, every slot is taken`,
    );
  });

  it('frees a slot when a zip is read to the end', async () => {
    const { downloads } = service(auto());
    const [first] = await open(downloads, 4);
    for await (const _chunk of first!.body) void _chunk;
    await settle();
    expect(downloads.busy()).toBe(false);
    await open(downloads, 1);
    expect(downloads.busy()).toBe(true);
  });

  it('frees the slot of an organiser who left once the bucket read under way ends', async () => {
    const held: Array<() => void> = [];
    const store: PhotoStore = {
      ...heldStore({}).store,
      get: (key) =>
        key === rows[1]!.original_key
          ? new Promise((resolve) => held.push(() => resolve(jpeg(2))))
          : Promise.resolve(key === rows[0]!.original_key ? jpeg(1) : jpeg(3)),
    };
    const { downloads } = service(store);
    const [leaving] = await open(downloads, 4);
    leaving!.body.on('data', () => {});
    await settle();
    leaving!.body.destroy();
    await settle();
    expect(downloads.busy()).toBe(true);
    held.splice(0).forEach((release) => release());
    await settle();
    await settle();
    expect(downloads.busy()).toBe(false);
  });

  it('frees the slot of a zip that fails before its body, so five failures in a row all run', async () => {
    const { downloads } = service(auto(), { data: null, error: { message: 'connection reset' } });
    for (let i = 0; i < 5; i += 1) {
      await expect(zip(downloads)).rejects.toThrow('connection reset');
    }
    expect(downloads.busy()).toBe(false);
  });
});

describe('PhotoDownloadService.zip — an idle reader', () => {
  it('cuts a zip nobody takes from for two minutes, logs why, and frees its slot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { downloads } = service(auto());
    const [first] = await open(downloads, 4);
    vi.advanceTimersByTime(119_999);
    await settle();
    expect(downloads.busy()).toBe(true);
    vi.advanceTimersByTime(1);
    await settle();
    expect(first!.body.destroyed).toBe(true);
    expect(downloads.busy()).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      `Event ${EVENT.id}: the photo download failed after it started`,
      new Error('its reader took nothing for 120 s'),
    );
  });

  it('never cuts, nor logs, a zip read to the end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { downloads } = service(auto());
    const { body } = (await open(downloads, 1))[0]!;
    for await (const _chunk of body) void _chunk;
    await settle();
    vi.advanceTimersByTime(120_000);
    await settle();
    expect(logged).not.toHaveBeenCalled();
  });

  it('starts the two minutes again each time the reader takes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { downloads } = service(auto());
    const { body } = (await open(downloads, 1))[0]!;
    vi.advanceTimersByTime(100_000);
    body.read();
    await settle();
    vi.advanceTimersByTime(100_000);
    expect(body.destroyed).toBe(false);
    vi.advanceTimersByTime(20_000);
    await settle();
    expect(body.destroyed).toBe(true);
  });
});
