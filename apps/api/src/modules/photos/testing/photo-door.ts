/**
 * The photo upload door for the upload guard suites (`upload-limits.*.test.ts`): the real
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

const SECRET = 'test-photo-secret-at-least-32-characters-long';

export function photoDoor(
  eventId: string,
  { token }: { token?: string } = {},
): (req: never) => Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const db = mockSupabase(
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
    },
    {
      event_photo_usage: () => ({
        data: [{ event_last_hour: 0, event_bytes: 0, device_last_hour: 0 }],
        error: null,
      }),
    },
  );
  const config = { getOrThrow: () => SECRET, get: () => 'test' } as never;
  const store = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const controller = new PhotosController(
    new PhotoUploadService(db as never, config, store),
    new PhotoDeviceService(config),
    {} as never,
    config,
    db as never,
  );
  return (req) => {
    (req as { headers: Record<string, string> }).headers['x-photo-token'] =
      token ?? photoToken(SECRET, eventId, 1);
    return controller.upload(eventId, req, { setCookie: () => undefined } as never);
  };
}
