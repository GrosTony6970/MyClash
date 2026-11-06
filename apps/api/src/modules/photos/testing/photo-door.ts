/**
 * The photo upload doors for the upload guard suites (`upload-limits.*.test.ts`): the real
 * controller and the real upload service over a database where every check before the read
 * passes (a live Event open today, no photo sent yet), so what the suites see is the read itself.
 * `token` replaces the QR link's token, to drive the refusal before the read.
 *
 * Test-only. It calls no reader itself, so the upload source guard has nothing to find here.
 */
import { vi } from 'vitest';
import { mockSupabase } from '../../../common/testing/supabase-chain';
import { PhotoDeviceService } from '../photo-device';
import { photoToken } from '../photo-token';
import { PhotoUploadService } from '../photo-upload.service';
import { PhotosController } from '../photos.controller';
import { MyPhotosController } from '../my-photos.controller';

const SECRET = 'test-photo-secret-at-least-32-characters-long';

export function photoDoor(
  eventId: string,
  { token }: { token?: string } = {},
): (req: never) => Promise<unknown> {
  const db = openEventDb(eventId);
  const config = { getOrThrow: () => SECRET, get: () => 'test' } as never;
  const controller = new PhotosController(
    new PhotoUploadService(db as never, config, uploadOnlyStore(), {} as never),
    new PhotoDeviceService(config),
    {} as never,
    config,
    db as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return (req) => {
    (req as { headers: Record<string, string> }).headers['x-photo-token'] =
      token ?? photoToken(SECRET, eventId, 1);
    return controller.upload(eventId, req, { setCookie: () => undefined } as never);
  };
}

/**
 * The personal-space door (`POST me/events/:eventId/photos`): a signed-in member of the same open
 * Event, with a profile name, so what the suites see is the read itself. The request's
 * `Bearer <id>` is its user; `member: false` drives the refusal before the read.
 */
export function myPhotoDoor(
  eventId: string,
  { member = true }: { member?: boolean } = {},
): (req: never) => Promise<unknown> {
  const db = openEventDb(eventId);
  const supabase = { ...db, getAuthUser: vi.fn(async (token: string) => ({ id: token })) };
  const config = { getOrThrow: () => SECRET } as never;
  const myEvents = { listMyEvents: async () => (member ? [{ event: { id: eventId } }] : []) };
  const uploads = new PhotoUploadService(
    supabase as never,
    config,
    uploadOnlyStore(),
    myEvents as never,
  );
  const controller = new MyPhotosController(uploads, {} as never, supabase as never);
  return (req) => controller.upload(eventId, req);
}

/** A live Event open today, a profile name, no photo sent yet. */
function openEventDb(eventId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return mockSupabase(
    {
      events: {
        data: {
          id: eventId,
          start_date: today,
          end_date: today,
          timezone: 'UTC',
          photo_mode: 'live',
          photo_token_version: 1,
        },
        error: null,
      },
      event_photos: { data: null, error: null },
      global_persons: { data: { display_name: 'Léa Martin' }, error: null },
    },
    {
      event_photo_usage: () => ({
        data: [{ event_last_hour: 0, event_bytes: 0, sender_last_hour: 0 }],
        error: null,
      }),
    },
  );
}

/** A store that takes writes and refuses what an upload never does. */
function uploadOnlyStore() {
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
