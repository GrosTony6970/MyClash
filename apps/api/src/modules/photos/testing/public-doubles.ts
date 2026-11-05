import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import type { PublicReader } from '../../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../../common/auth/request-user';
import { mockSupabase, type SupabaseRow } from '../../../common/testing/supabase-chain';
import type { PhotoStore } from '../photo-bucket';
import { PhotoPublicService } from '../photo-public.service';
import { EVENT, ORG, recordingStore } from './moderation-doubles';

/** The public photo list and the Report over doubles: one Event, its Tournaments, its photos. */

export const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
export const HIDDEN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';
export const WORKSHOP = '33333333-3333-4333-8333-333333333333';
export const DRAFT_WORKSHOP = '44444444-4444-4444-8444-444444444444';
export const PHONE = '55555555-5555-4555-8555-555555555555';

export const ANONYMOUS: PublicReader = { userId: ANONYMOUS_USER_ID, staff: null };
export const MEMBER: PublicReader = { userId: 'member-1', staff: null };

export interface PublicSetup {
  event?: Partial<SupabaseRow> | null;
  photos?: SupabaseRow[];
  reports?: SupabaseRow[];
  store?: PhotoStore | null;
  /** The answer of the photo report write, when a test makes it fail. */
  reportError?: { code: string; message: string };
}

export function publicPhotos(options: PublicSetup = {}) {
  const event =
    options.event === null
      ? null
      : {
          id: EVENT,
          organization_id: ORG,
          status: 'running',
          event_kind: 'standard',
          slug: 'open-2026',
          name: 'Open 2026',
          start_date: '2026-11-07',
          end_date: '2026-11-08',
          timezone: 'Europe/Paris',
          photo_mode: 'live',
          photo_token_version: 1,
          ...options.event,
        };
  const supabase = mockSupabase({
    events: { data: event, error: null },
    tournaments: {
      rows: [
        { id: TOURNAMENT, event_id: EVENT, status: 'running' },
        { id: HIDDEN_TOURNAMENT, event_id: EVENT, status: 'draft' },
      ],
    },
    workshops: {
      rows: [
        { id: WORKSHOP, event_id: EVENT, status: 'published' },
        { id: DRAFT_WORKSHOP, event_id: EVENT, status: 'draft' },
      ],
    },
    event_photos: { rows: options.photos ?? [] },
    event_photo_reports: { rows: options.reports ?? [] },
  });
  if (options.reportError) failReportWrites(supabase.from, options.reportError);
  // A club member of the Event's club; everyone else is refused.
  const orgs = {
    assertOrgRole: vi.fn(async (_org: string, userId: string) => {
      if (userId !== MEMBER.userId) throw new ForbiddenException('Not a member of this club');
    }),
  };
  const store = options.store === undefined ? recordingStore() : options.store;
  const service = new PhotoPublicService(supabase as never, orgs as never, store);
  return { service, supabase, orgs, store };
}

/** The reports' write answers `error`; their reads still see the seeded rows. */
function failReportWrites(
  from: ReturnType<typeof mockSupabase>['from'],
  error: { code: string; message: string },
): void {
  const real = from.getMockImplementation();
  if (!real) throw new Error('mockSupabase gave from() no implementation');
  from.mockImplementation((table: string) => {
    const chain = real(table);
    if (table === 'event_photo_reports') {
      chain['upsert'] = vi.fn(() => Promise.resolve({ data: null, error })) as never;
    }
    return chain;
  });
}
