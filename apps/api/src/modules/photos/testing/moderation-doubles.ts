import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../../common/testing/supabase-chain';
import type { PhotoStore } from '../photo-bucket';
import { PhotoModerationService } from '../photo-moderation.service';

/** The organiser's moderation queue over doubles: one Event, its club, its photos. */

export const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
export const OTHER_EVENT = '0b5e2c1a-3d4f-4e6a-9b8c-7d6e5f4a3b2c';
export const ORG = 'org-1';
export const USER = 'user-7';

/** When photo `n` arrived, in PostgREST's own shape: photo 0 is the newest, one second apart. */
export function arrivedAt(n: number): string {
  const at = new Date(Date.UTC(2026, 10, 5, 12, 0, 0) - n * 1000).toISOString();
  return at.replace('.000Z', '.123456+00:00');
}

/** A photo row as the queue reads it. */
export function photoRow(n: number, over: Partial<SupabaseRow> = {}): SupabaseRow {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    event_id: EVENT,
    status: 'waiting',
    uploader_name: null,
    caption: null,
    created_at: arrivedAt(n),
    preview_key: `events/${EVENT}/${id}/preview.jpg`,
    original_key: `events/${EVENT}/${id}/original.jpg`,
    tournament: null,
    workshop: null,
    ...over,
  };
}

/** Signs a link as its key and signing time, so a test can read both back. */
export const recordingStore = (failOn?: string): PhotoStore => ({
  put: async () => {
    throw new Error('moderation never writes an image');
  },
  remove: async () => {
    throw new Error('moderation never deletes an image itself');
  },
  list: async () => {
    throw new Error('moderation never lists the bucket');
  },
  link: vi.fn(async (key: string, now: Date) => {
    if (key === failOn) throw new Error('signing failed');
    return `https://signed.test/${key}@${now.toISOString()}`;
  }),
});

export interface ModerationSetup {
  allowed?: boolean;
  event?: Partial<SupabaseRow> | null;
  photos?: SupabaseRow[];
  store?: PhotoStore | null;
  usage?: { event_last_hour: number; event_bytes: number | string };
  add?: () => Promise<unknown>;
}

export function moderation(options: ModerationSetup = {}) {
  const event =
    options.event === null
      ? null
      : {
          id: EVENT,
          organization_id: ORG,
          slug: 'open-2026',
          name: 'Open 2026',
          start_date: '2026-11-07',
          end_date: '2026-11-08',
          timezone: 'Europe/Paris',
          photo_mode: 'approve',
          photo_token_version: 1,
          ...options.event,
        };
  const supabase = mockSupabase(
    {
      events: { data: event, error: null },
      event_photos: { rows: options.photos ?? [] },
    },
    {
      event_photo_usage: () => ({
        data: [
          { device_last_hour: 0, ...(options.usage ?? { event_last_hour: 0, event_bytes: 0 }) },
        ],
        error: null,
      }),
    },
  );
  const orgs = {
    assertOrgRole: vi.fn(async () => {
      if (options.allowed === false) throw new ForbiddenException('Not an admin of this club');
    }),
  };
  const store = options.store === undefined ? recordingStore() : options.store;
  const queue = { add: vi.fn(options.add ?? (async () => ({ id: 'job-1' }))) };
  const service = new PhotoModerationService(
    supabase as never,
    orgs as never,
    store,
    queue as never,
  );
  return { service, supabase, orgs, store, queue };
}
