import { HttpException } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type RpcAnswer } from '../../common/testing/supabase-chain';
import type { PhotoStore } from './photo-bucket';
import { DEVICE_PHOTOS_PER_HOUR, PhotoUploadService } from './photo-upload.service';
import { ACCOUNT_PHOTOS_PER_HOUR } from './photo-upload.service';
import { loadedJpeg } from './testing/synthetic-jpeg';
import { photoToken } from './photo-token';

/**
 * A photo sent from a personal space (design Goal 11, slice 6a): one of her own Events, under her
 * profile name whatever name is sent, her account's hour, the QR path's mode, window and caps.
 */
const SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const OTHER = 'a1b2c3d4-0000-4000-8000-000000000001';
const UID = 'uid-1';
const DEVICE = '2b1e8a6c-0d4f-4c3e-9a7b-5f6e7d8c9b0a';
const TODAY = new Date().toISOString().slice(0, 10);
const READER = { userId: UID, staff: null };

let photo: Buffer;
beforeAll(async () => {
  photo = await loadedJpeg({ orientation: 1 });
});

interface Setup {
  mode?: 'off' | 'live' | 'approve';
  days?: [string, string];
  mine?: string[] | Error;
  profile?: string | null;
  senderLastHour?: number;
}

function setup(options: Setup = {}) {
  const db = database(options);
  const getUserById = vi.fn(async () => ({
    data: { user: { id: UID, email: 'lea@example.test', user_metadata: {} } },
    error: null,
  }));
  const supabase = { ...db, service: { ...db.service, auth: { admin: { getUserById } } } };
  const mine = options.mine ?? [OTHER, EVENT];
  const listMyEvents = vi.fn(async () => {
    if (mine instanceof Error) throw mine;
    return mine.map((id) => ({ event: { id } }));
  });
  const service = new PhotoUploadService(
    supabase as never,
    { getOrThrow: () => SECRET } as never,
    writeOnlyStore(),
    { listMyEvents } as never,
  );
  return { service, db, listMyEvents };
}

/** An open Event in the asked mode, her profile, and her hour so far. */
function database(options: Setup) {
  const usage: RpcAnswer = () => ({
    data: [{ event_last_hour: 0, event_bytes: 0, sender_last_hour: options.senderLastHour ?? 0 }],
    error: null,
  });
  return mockSupabase(
    {
      events: {
        data: {
          id: EVENT,
          start_date: options.days?.[0] ?? TODAY,
          end_date: options.days?.[1] ?? TODAY,
          timezone: 'UTC',
          photo_mode: options.mode ?? 'live',
          photo_token_version: 1,
        },
        error: null,
      },
      global_persons: {
        data: options.profile === null ? null : { display_name: options.profile ?? 'Léa Martin' },
        error: null,
      },
      event_photos: { data: null, error: null },
    },
    { event_photo_usage: usage },
  );
}

/** A store that takes writes and refuses what an upload never does. */
function writeOnlyStore(): PhotoStore {
  return {
    put: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    get: vi.fn(async () => {
      throw new Error('the upload never reads an image back');
    }),
    list: vi.fn(async () => {
      throw new Error('the upload never lists the bucket');
    }),
    link: vi.fn(async () => {
      throw new Error('the upload never signs a link');
    }),
  };
}

function request(fields: Record<string, string> = {}) {
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
        toBuffer: async () => photo,
      };
    })(),
  );
  return { req: { headers: {}, cookies: {}, parts } as never, parts };
}

const account = { kind: 'account', reader: READER } as const;

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException)) throw new Error(`not refused: ${String(err)}`);
  return { status: err.getStatus(), code: (err.getResponse() as { code?: unknown }).code };
}

const rowOf = (db: ReturnType<typeof setup>['db']) =>
  writesTo(db, 'event_photos')[0]?.row as Record<string, unknown> | undefined;

describe('PhotoUploadService — a photo sent from a personal space', () => {
  it('a member sends a photo under her profile name; the sent name is ignored', async () => {
    const { service, db } = setup();
    const { req } = request({ name: 'x'.repeat(60), caption: 'Final' });
    expect(await service.upload(EVENT, account, req)).toMatchObject({ status: 'approved' });
    expect(rowOf(db)).toMatchObject({
      uploader_name: 'Léa Martin',
      uploader_user_id: UID,
      device_id: null,
      caption: 'Final',
    });
  });

  // Which Events are hers is `listMyEvents`' to say (its own tests); the upload takes its word.
  it('an Event that is her only listed one takes her photo', async () => {
    const { service, db } = setup({ mine: [EVENT] });
    await service.upload(EVENT, account, request().req);
    expect(rowOf(db)).toMatchObject({ uploader_user_id: UID });
  });

  it('Approve first: her photo waits', async () => {
    const { service } = setup({ mode: 'approve' });
    expect(await service.upload(EVENT, account, request().req)).toMatchObject({
      status: 'waiting',
    });
  });

  it('counts her last hour by account', async () => {
    const { service, db } = setup();
    await service.upload(EVENT, account, request().req);
    expect(db.rpc).toHaveBeenCalledWith('event_photo_usage', {
      p_event_id: EVENT,
      p_device_id: null,
      p_user_id: UID,
    });
  });
});

describe('PhotoUploadService — a personal-space photo refused before the file is read', () => {
  it('refuses an Event outside her own Events', async () => {
    const { service, db } = setup({ mine: [OTHER, 'a1b2c3d4-0000-4000-8000-000000000002'] });
    const { req, parts } = request();
    expect(await refusal(service.upload(EVENT, account, req))).toEqual({
      status: 403,
      code: 'photo_not_your_event',
    });
    expect(parts).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('a failed membership read is unavailable, not "not your event"', async () => {
    const { service } = setup({ mine: new Error('My events: profile not read: boom') });
    expect(await refusal(service.upload(EVENT, account, request().req))).toEqual({
      status: 503,
      code: 'photos_unavailable',
    });
  });

  it('refuses with no name', async () => {
    const { service } = setup({ profile: null });
    const { req, parts } = request();
    expect(await refusal(service.upload(EVENT, account, req))).toEqual({
      status: 403,
      code: 'photo_no_name',
    });
    expect(parts).not.toHaveBeenCalled();
  });

  it.each([
    ['photos off', { mode: 'off' }, 'photos_off'],
    ['outside the window', { days: ['2099-01-10', '2099-01-11'] }, 'photos_window_closed'],
  ] as const)('%s refuses before the membership read', async (_name, options, code) => {
    const { service, listMyEvents } = setup(options as Setup);
    expect(await refusal(service.upload(EVENT, account, request().req))).toMatchObject({ code });
    expect(listMyEvents).not.toHaveBeenCalled();
  });

  it("her account's hour is her own code", async () => {
    const { service } = setup({ senderLastHour: ACCOUNT_PHOTOS_PER_HOUR });
    expect(await refusal(service.upload(EVENT, account, request().req))).toEqual({
      status: 429,
      code: 'photo_account_limit',
    });
  });
});

describe('PhotoUploadService — the QR path beside it', () => {
  const phone = { kind: 'phone', token: photoToken(SECRET, EVENT, 1), deviceId: DEVICE } as const;

  it('stores no account and counts by phone', async () => {
    const { service, db, listMyEvents } = setup();
    await service.upload(EVENT, phone, request({ name: 'Alex' }).req);
    expect(rowOf(db)).toMatchObject({
      uploader_name: 'Alex',
      uploader_user_id: null,
      device_id: DEVICE,
    });
    expect(db.rpc).toHaveBeenCalledWith('event_photo_usage', {
      p_event_id: EVENT,
      p_device_id: DEVICE,
      p_user_id: null,
    });
    expect(listMyEvents).not.toHaveBeenCalled();
  });

  it("the phone's hour keeps the phone's code", async () => {
    const { service } = setup({ senderLastHour: DEVICE_PHOTOS_PER_HOUR });
    expect(await refusal(service.upload(EVENT, phone, request().req))).toEqual({
      status: 429,
      code: 'photo_device_limit',
    });
  });
});
