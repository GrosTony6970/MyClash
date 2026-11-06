import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from '../../common/event-readonly/allow-on-archived.decorator';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { MyPhotosController } from './my-photos.controller';
import { myPhotoQuerySchema } from './photo-public.dto';
import { MyPhotosService } from './my-photos.service';

/**
 * A personal space's own photos (design Goal 11, slice 6a): she lists the photos she sent from
 * it, newest first, waiting ones too, and deletes her own; another's is not found.
 */
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const OTHER_EVENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const UID = 'uid-1';
const MINE = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const photoRow = (over: Record<string, unknown>) => ({
  id: MINE,
  event_id: EVENT,
  uploader_user_id: UID,
  device_id: null,
  status: 'approved',
  caption: null,
  created_at: '2026-11-07T10:00:00+00:00',
  preview_key: `events/${EVENT}/${String(over['id'] ?? MINE)}/preview.jpg`,
  original_key: `events/${EVENT}/${String(over['id'] ?? MINE)}/original.jpg`,
  tournament: null,
  workshop: null,
  ...over,
});

function setup(photos: Record<string, unknown>[] = [photoRow({})]) {
  const db = mockSupabase({
    event_photos: { rows: photos },
    global_persons: { data: { display_name: 'Léa Martin' }, error: null },
  });
  const supabase = { ...db, getAuthUser: vi.fn(async (token: string) => ({ id: token })) };
  const store = {
    put: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
    link: vi.fn(async (key: string) => `https://bucket.test/${key}`),
  };
  const queue = { add: vi.fn(async () => ({ id: 'job-1' })) };
  const service = new MyPhotosService(supabase as never, store as never, queue as never);
  const uploads = { upload: vi.fn(async () => ({ id: 'p1', status: 'waiting' as const })) };
  const controller = new MyPhotosController(uploads as never, service, supabase as never);
  return { db, controller, queue, uploads };
}

const signedIn = { headers: { authorization: `Bearer ${UID}` }, cookies: {} } as never;
const signedOut = { headers: {}, cookies: {} } as never;

describe('GET me/events/:eventId/photos', () => {
  it('lists only her photos of this Event, newest first, waiting ones included, with the name shown', async () => {
    const { db, controller } = setup([
      photoRow({ id: 'p-old', created_at: '2026-11-07T09:00:00+00:00' }),
      photoRow({ id: 'p-new', status: 'waiting', created_at: '2026-11-07T11:00:00+00:00' }),
      photoRow({ id: 'p-theirs', uploader_user_id: 'uid-2' }),
      photoRow({ id: 'p-qr', uploader_user_id: null, device_id: 'dev-1' }),
      photoRow({ id: 'p-elsewhere', event_id: OTHER_EVENT }),
    ]);
    const page = await controller.list(EVENT, {}, signedIn);

    expect(page.posterName).toBe('Léa Martin');
    expect(page.photos.map((photo) => [photo.id, photo.status])).toEqual([
      ['p-new', 'waiting'],
      ['p-old', 'approved'],
    ]);
    expect(page.photos[0]).toMatchObject({
      previewUrl: `https://bucket.test/events/${EVENT}/p-new/preview.jpg`,
      originalUrl: `https://bucket.test/events/${EVENT}/p-new/original.jpg`,
      tag: null,
    });
    expect(page.next).toBeNull();
    expect(selectsFor(db.from, 'event_photos')).toEqual([
      'id, status, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title)',
    ]);
    expect(filtersFor(db.from, 'event_photos', 'eq')).toEqual([
      ['event_id', EVENT],
      ['uploader_user_id', UID],
    ]);
  });

  it('pages by 30 from before', async () => {
    const rows = Array.from({ length: 31 }, (_, i) =>
      photoRow({
        id: `p-${i}`,
        created_at: `2026-11-07T10:${String(i).padStart(2, '0')}:00+00:00`,
      }),
    );
    const { db, controller } = setup(rows);
    const first = await controller.list(EVENT, {}, signedIn);
    expect(first.photos).toHaveLength(30);
    expect(first.next).toBe('2026-11-07T10:01:00+00:00');

    const second = await controller.list(EVENT, { before: first.next! }, signedIn);
    expect(second.photos.map((photo) => photo.id)).toEqual(['p-0']);
    expect(second.next).toBeNull();
    expect(filtersFor(db.from, 'event_photos', 'lt')).toEqual([
      ['created_at', '2026-11-07T10:01:00+00:00'],
    ]);
  });

  it('refuses a cursor that is not a time', () => {
    expect(myPhotoQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false);
    expect(myPhotoQuerySchema.safeParse({ before: '2026-11-07T10:01:00+00:00' }).success).toBe(
      true,
    );
    expect(myPhotoQuerySchema.safeParse({ other: 'x' }).success).toBe(false);
  });
});

describe('DELETE me/events/:eventId/photos/:photoId', () => {
  it('deletes her own photo and asks for a drain', async () => {
    const { db, controller, queue } = setup();
    await controller.remove(EVENT, MINE, signedIn);

    const [write] = writesTo(db, 'event_photos');
    expect(write?.op).toBe('delete');
    expect(write?.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['id', MINE] },
        { method: 'eq', args: ['event_id', EVENT] },
        { method: 'eq', args: ['uploader_user_id', UID] },
      ]),
    );
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it.each([
    ["another person's photo", photoRow({ uploader_user_id: 'uid-2' })],
    ['a QR photo', photoRow({ uploader_user_id: null, device_id: 'dev-1' })],
    ["another Event's photo", photoRow({ event_id: OTHER_EVENT })],
  ])('%s is not found, and no drain is asked for', async (_what, row) => {
    const { controller, queue } = setup([row]);
    const refusal = await controller.remove(EVENT, MINE, signedIn).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(404);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: 'photo_not_found' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('is open on an archived Event (a person may ask for her photo to go)', () => {
    const allowed = new Reflector().get<boolean>(
      ALLOW_ON_ARCHIVED_EVENT_KEY,
      MyPhotosController.prototype.remove,
    );
    expect(allowed).toBe(true);
  });
});

describe('POST me/events/:eventId/photos', () => {
  it('sends as her account, with her staff cookie read for the draft bar', async () => {
    const { controller, uploads } = setup();
    await controller.upload(EVENT, signedIn);
    expect(uploads.upload).toHaveBeenCalledWith(
      EVENT,
      { kind: 'account', reader: { userId: UID, staff: null } },
      signedIn,
    );
  });
});

describe('a signed-out caller', () => {
  it('is refused on all three, before anything is read', async () => {
    const { db, controller, uploads } = setup();
    await expect(controller.upload(EVENT, signedOut)).rejects.toThrow(UnauthorizedException);
    await expect(controller.list(EVENT, {}, signedOut)).rejects.toThrow(UnauthorizedException);
    await expect(controller.remove(EVENT, MINE, signedOut)).rejects.toThrow(UnauthorizedException);
    expect(uploads.upload).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});
