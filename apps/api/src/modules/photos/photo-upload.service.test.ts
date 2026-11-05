import { crc32 } from 'node:zlib';
import { HttpException, Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makePreview } from './photo-preview';
import type * as PreviewModule from './photo-preview';

// The real preview maker, made swappable for one test of a fault inside it.
vi.mock('./photo-preview', async (importOriginal) => {
  const real = await importOriginal<typeof PreviewModule>();
  return { ...real, makePreview: vi.fn(real.makePreview) };
});
import { OperationalUnavailableException } from '../../common/operational-exception';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import type { RpcAnswer } from '../../common/testing/supabase-chain';
import { stripJpeg } from './jpeg-strip';
import type { PhotoStore } from './photo-bucket';
import { photoToken } from './photo-token';
import {
  DEVICE_PHOTOS_PER_HOUR,
  EVENT_PHOTO_BYTES,
  EVENT_PHOTOS_PER_HOUR,
  PHOTO_UPLOAD_SLOTS,
  PhotoUploadService,
} from './photo-upload.service';
import { loadedJpeg } from './testing/synthetic-jpeg';

const SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const DEVICE = '2b1e8a6c-0d4f-4c3e-9a7b-5f6e7d8c9b0a';
const TOURNAMENT = '3c2f9b7d-1e5a-4d4f-8b8c-6a7f8e9d0c1b';
const TODAY = new Date().toISOString().slice(0, 10);
const TOKEN = photoToken(SECRET, EVENT, 2);

let photo: Buffer;
beforeAll(async () => {
  photo = await loadedJpeg({ orientation: 6 });
});

interface Setup {
  mode?: 'off' | 'live' | 'approve';
  days?: [string, string];
  usage?: { event_last_hour?: number; event_bytes?: number; device_last_hour?: number };
  store?: PhotoStore | null;
  insertError?: { message: string };
  tagError?: { message: string };
}

function setup(options: Setup = {}) {
  const event = {
    id: EVENT,
    start_date: options.days?.[0] ?? TODAY,
    end_date: options.days?.[1] ?? TODAY,
    timezone: 'UTC',
    photo_mode: options.mode ?? 'live',
    photo_token_version: 2,
  };
  const usage: RpcAnswer = () => ({
    data: [{ event_last_hour: 0, event_bytes: 0, device_last_hour: 0, ...options.usage }],
    error: null,
  });
  const supabase = mockSupabase(
    {
      events: { data: event, error: null },
      tournaments: options.tagError
        ? { data: null, error: options.tagError }
        : { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
      workshops: { rows: [] },
      event_photos: { data: null, error: options.insertError ?? null },
    },
    { event_photo_usage: usage },
  );
  const stored = new Map<string, Buffer>();
  const store: PhotoStore = {
    put: vi.fn(async (key: string, bytes: Buffer) => void stored.set(key, bytes)),
    remove: vi.fn(async (key: string) => void stored.delete(key)),
    list: vi.fn(async () => {
      throw new Error('the upload never lists the bucket');
    }),
  };
  const chosen = options.store === undefined ? store : options.store;
  const service = new PhotoUploadService(
    supabase as never,
    { getOrThrow: () => SECRET } as never,
    chosen,
  );
  return { service, supabase, store, stored };
}

function request(fields: Record<string, string> = {}, bytes: Buffer = photo) {
  const parts = vi.fn(() =>
    (async function* () {
      for (const [fieldname, value] of Object.entries(fields))
        yield { type: 'field', fieldname, value };
      yield {
        type: 'file',
        fieldname: 'file',
        filename: 'IMG_0001.jpg',
        mimetype: 'image/jpeg',
        file: { resume: vi.fn(), truncated: false },
        toBuffer: async () => bytes,
      };
    })(),
  );
  return { req: { headers: {}, cookies: {}, parts } as never, parts };
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException)) throw new Error(`not refused: ${String(err)}`);
  return { status: err.getStatus(), code: (err.getResponse() as { code?: unknown }).code };
}

describe('PhotoUploadService — refused before the file is read', () => {
  it.each([
    ['a wrong token', {}, 'not-the-token', 403, 'photo_link_invalid'],
    ['a retired token', {}, photoToken(SECRET, EVENT, 1), 403, 'photo_link_invalid'],
    ['photos off', { mode: 'off' }, TOKEN, 403, 'photos_off'],
    [
      'outside the window',
      { days: ['2099-01-10', '2099-01-11'] },
      TOKEN,
      403,
      'photos_window_closed',
    ],
    ['no bucket', { store: null }, TOKEN, 503, 'photos_unavailable'],
    [
      'the device limit',
      { usage: { device_last_hour: DEVICE_PHOTOS_PER_HOUR } },
      TOKEN,
      429,
      'photo_device_limit',
    ],
    [
      'the Event hourly cap',
      { usage: { event_last_hour: EVENT_PHOTOS_PER_HOUR } },
      TOKEN,
      429,
      'photo_event_limit',
    ],
    [
      'the Event storage cap',
      { usage: { event_bytes: EVENT_PHOTO_BYTES - 1024 } },
      TOKEN,
      429,
      'photo_event_storage_full',
    ],
  ] as const)('%s', async (_name, options, token, status, code) => {
    const { service } = setup(options as Setup);
    const { req, parts } = request();
    expect(await refusal(service.upload(EVENT, token, DEVICE, req))).toEqual({ status, code });
    expect(parts).not.toHaveBeenCalled();
  });

  it('answers the bucket-down and busy refusals through the operational marker', async () => {
    const { service } = setup({ store: null });
    const err = await service.upload(EVENT, TOKEN, DEVICE, request().req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OperationalUnavailableException);
  });

  it('asks the database for exactly the Event columns it checks, and counts by function', async () => {
    const { service, supabase } = setup();
    await service.upload(EVENT, TOKEN, DEVICE, request().req);
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, start_date, end_date, timezone, photo_mode, photo_token_version',
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith('event_photo_usage', {
      p_event_id: EVENT,
      p_device_id: DEVICE,
    });
  });
});

describe('PhotoUploadService — a photo that passes', () => {
  it('stores the stripped original and its preview, then writes the row', async () => {
    const { service, supabase, stored } = setup({ mode: 'live' });
    const result = await service.upload(
      EVENT,
      TOKEN,
      DEVICE,
      request({ name: '  Alex  ', caption: 'Final, piste 2', tournamentId: TOURNAMENT }).req,
    );

    const original = stripJpeg(photo).bytes;
    const [row] = writesTo(supabase, 'event_photos').map((w) => w.row as Record<string, unknown>);
    expect(result).toEqual({ id: row!['id'], status: 'approved' });
    expect(row).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      event_id: EVENT,
      tournament_id: TOURNAMENT,
      workshop_id: null,
      status: 'approved',
      uploader_name: 'Alex',
      caption: 'Final, piste 2',
      device_id: DEVICE,
      original_key: `events/${EVENT}/${String(row!['id'])}/original.jpg`,
      preview_key: `events/${EVENT}/${String(row!['id'])}/preview.jpg`,
      byte_size: original.length,
      crc32: crc32(original),
    });
    expect(stored.get(String(row!['original_key']))!.equals(original)).toBe(true);
    expect(stored.get(String(row!['original_key']))!.includes('CANARY-EXIF')).toBe(false);
    expect(stored.has(String(row!['preview_key']))).toBe(true);
  });

  it('waits for approval in approve-first mode', async () => {
    const { service } = setup({ mode: 'approve' });
    expect(await service.upload(EVENT, TOKEN, DEVICE, request().req)).toMatchObject({
      status: 'waiting',
    });
  });

  it('stores an empty name and caption as none', async () => {
    const { service, supabase } = setup();
    await service.upload(EVENT, TOKEN, DEVICE, request({ name: '   ', caption: '' }).req);
    expect(writesTo(supabase, 'event_photos')[0]!.row).toMatchObject({
      uploader_name: null,
      caption: null,
    });
  });
});

describe('PhotoUploadService — refused after the read', () => {
  it.each([
    ['a 41-character name', { name: 'x'.repeat(41) }, 'photo_text_too_long'],
    ['a 201-character caption', { caption: 'x'.repeat(201) }, 'photo_text_too_long'],
    [
      'a Tournament of another Event',
      { tournamentId: '00000000-0000-4000-8000-000000000000' },
      'photo_tag_invalid',
    ],
    ['two tags', { tournamentId: TOURNAMENT, workshopId: TOURNAMENT }, 'photo_tag_invalid'],
  ])('%s', async (_name, fields, code) => {
    const { service, store } = setup();
    expect(await refusal(service.upload(EVENT, TOKEN, DEVICE, request(fields).req))).toEqual({
      status: 400,
      code,
    });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses a HEIC with its own code, and stores nothing', async () => {
    const { service, store } = setup();
    const heic = Buffer.from('\x00\x00\x00\x18ftypheic0000', 'latin1');
    expect(await refusal(service.upload(EVENT, TOKEN, DEVICE, request({}, heic).req))).toEqual({
      status: 422,
      code: 'photo_heic',
    });
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('PhotoUploadService — never a row without both images', () => {
  it('deletes the stored original when the preview cannot be stored', async () => {
    const { service, supabase, store, stored } = setup();
    vi.mocked(store.put)
      .mockImplementationOnce(async (key, bytes) => void stored.set(key, bytes))
      .mockRejectedValueOnce(new Error('bucket timeout'));

    expect(await refusal(service.upload(EVENT, TOKEN, DEVICE, request().req))).toEqual({
      status: 503,
      code: 'photos_unavailable',
    });
    expect(writesTo(supabase, 'event_photos')).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('deletes both images when the row cannot be written', async () => {
    const { service, stored } = setup({ insertError: { message: 'insert failed' } });
    await expect(service.upload(EVENT, TOKEN, DEVICE, request().req)).rejects.toThrow();
    expect(stored.size).toBe(0);
  });
});

describe('PhotoUploadService — faults leave a trace', () => {
  it('tells a fault of the preview maker apart in the log, while the phone hears "unreadable"', async () => {
    const { service } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.mocked(makePreview).mockRejectedValueOnce(new Error('vips: out of memory'));

    expect(await refusal(service.upload(EVENT, TOKEN, DEVICE, request().req))).toEqual({
      status: 422,
      code: 'photo_corrupt',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vips: out of memory'));
    warn.mockRestore();
  });

  it('removes both images when a write timed out after the bucket kept it', async () => {
    const { service, store, stored } = setup();
    vi.mocked(store.put)
      .mockImplementationOnce(async (key, bytes) => void stored.set(key, bytes))
      .mockImplementationOnce(async (key, bytes) => {
        stored.set(key, bytes);
        throw new Error('timed out waiting for the answer');
      });

    await service.upload(EVENT, TOKEN, DEVICE, request().req).catch(() => undefined);
    expect(stored.size).toBe(0);
  });

  it('reports a database fault on the tag check instead of calling the tag invalid', async () => {
    const { service } = setup({ tagError: { message: 'db down' } });
    const err = await service
      .upload(EVENT, TOKEN, DEVICE, request({ tournamentId: TOURNAMENT }).req)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(HttpException);
    expect(String(err)).toContain('db down');
  });

  it('refuses a tag that is not an id without asking the database', async () => {
    const { service, supabase } = setup();
    expect(
      await refusal(service.upload(EVENT, TOKEN, DEVICE, request({ tournamentId: 'abc' }).req)),
    ).toEqual({ status: 400, code: 'photo_tag_invalid' });
    expect(supabase.from.mock.calls.map(([t]) => t)).not.toContain('tournaments');
  });
});

describe('PhotoUploadService — at most four photos at once', () => {
  it('turns the fifth away, and takes one again once a slot frees', async () => {
    const { service, store, stored } = setup();
    const gates: Array<() => void> = [];
    vi.mocked(store.put).mockImplementation(
      (key, bytes) =>
        new Promise<void>((resolve) =>
          gates.push(() => {
            stored.set(key, bytes);
            resolve();
          }),
        ),
    );

    const running = Array.from({ length: PHOTO_UPLOAD_SLOTS }, () =>
      service.upload(EVENT, TOKEN, DEVICE, request().req),
    );
    await vi.waitFor(() => expect(gates).toHaveLength(PHOTO_UPLOAD_SLOTS));

    const fifth = request();
    expect(await refusal(service.upload(EVENT, TOKEN, DEVICE, fifth.req))).toEqual({
      status: 503,
      code: 'photos_busy',
    });
    expect(fifth.parts).not.toHaveBeenCalled();

    vi.mocked(store.put).mockImplementation(async (key, bytes) => void stored.set(key, bytes));
    while (gates.length > 0) gates.shift()!();
    await Promise.all(running);
    await expect(service.upload(EVENT, TOKEN, DEVICE, request().req)).resolves.toBeTruthy();
  });

  it('gives the slot back when the photo is refused after the read', async () => {
    const { service } = setup();
    const heic = Buffer.from('\x00\x00\x00\x18ftypheic0000', 'latin1');
    for (let i = 0; i < PHOTO_UPLOAD_SLOTS + 1; i += 1) {
      await service.upload(EVENT, TOKEN, DEVICE, request({}, heic).req).catch(() => undefined);
    }
    await expect(service.upload(EVENT, TOKEN, DEVICE, request().req)).resolves.toBeTruthy();
  });
});
