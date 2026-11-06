import { ForbiddenException } from '@nestjs/common';
import type { PhotoQueueFilter } from '@myclash/types';
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
    reports: [],
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

/** The request a staff route hands its gate; the staff double reads nothing off it. */
export const STAFF_REQ = { cookies: { mc_staff: 'signed' } } as never;

export interface ModerationSetup {
  allowed?: boolean;
  /** The staff gate's answer: the login's Event, or a refusal. */
  staff?: { eventId: string } | Error;
  event?: Partial<SupabaseRow> | null;
  photos?: SupabaseRow[];
  reports?: SupabaseRow[];
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
      event_photo_reports: { rows: options.reports ?? [] },
    },
    {
      event_photo_usage: () => ({
        data: [
          { sender_last_hour: 0, ...(options.usage ?? { event_last_hour: 0, event_bytes: 0 }) },
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
  const staff = staffGate(options.staff ?? { eventId: EVENT });
  const store = options.store === undefined ? recordingStore() : options.store;
  const queue = { add: vi.fn(options.add ?? (async () => ({ id: 'job-1' }))) };
  const service = new PhotoModerationService(
    supabase as never,
    orgs as never,
    staff as never,
    store,
    queue as never,
  );
  return { service, organiser: asOrganiser(service), supabase, orgs, staff, store, queue };
}

/** `StaffService.requireStaffWithRole`: the login's Event, or the refusal it was given. */
function staffGate(answer: { eventId: string } | Error) {
  return {
    requireStaffWithRole: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return { id: 'staff-1', event_id: answer.eventId, role: 'photos' };
    }),
  };
}

/** The calls behind the organiser's gate, as `PhotosController` makes them. */
function asOrganiser(service: PhotoModerationService) {
  const gate = (eventId: string, userId: string) => service.eventForOrganiser(eventId, userId);
  return {
    summary: async (eventId: string, userId: string) =>
      service.summary(await gate(eventId, userId)),
    list: async (eventId: string, userId: string, filter: PhotoQueueFilter, before?: string) =>
      service.list(await gate(eventId, userId), filter, before),
    approve: async (eventId: string, photoId: string, userId: string) =>
      service.approve(await gate(eventId, userId), photoId),
    remove: async (eventId: string, photoId: string, userId: string) =>
      service.remove(await gate(eventId, userId), photoId),
    keep: async (eventId: string, photoId: string, userId: string, reportsUpTo: string) =>
      service.keep(await gate(eventId, userId), photoId, reportsUpTo),
  };
}
