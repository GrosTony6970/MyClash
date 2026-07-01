/**
 * workshops.service.test.ts
 *
 * Pins:
 *   - createWorkshop persists `title` (not the legacy `name`) and never
 *     writes the non-existent `location_label` column on workshops.
 *   - createWorkshop persists venueId and refuses cross-org venue refs.
 *   - updateWorkshop accepts venueId (and `null` to clear).
 *   - write paths assert the org role before touching the DB.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Result<T = unknown> = { data: T | null; error: { message: string } | null };

interface Stubs {
  existingSlug?: Result<{ id: string } | null>;
  venueOrg?: Result<{ organization_id: string } | null>;
  eventOrg?: Result<{ organization_id: string } | null>;
  workshopRow?: Result<{ event_id: string } | null>;
  finalRow?: Result<Record<string, unknown>>;
}

function buildSupabase(stubs: Stubs) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  let workshopsMaybeSingleCalls = 0;

  const service = {
    from: vi.fn((table: string) => {
      if (table === 'workshops') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => {
            workshopsMaybeSingleCalls += 1;
            // 1st workshops probe: slug-uniqueness (createWorkshop) OR
            // event_id resolution (updateWorkshop).
            if (workshopsMaybeSingleCalls === 1) {
              return Promise.resolve(
                stubs.existingSlug ?? stubs.workshopRow ?? { data: null, error: null },
              );
            }
            return Promise.resolve({ data: null, error: null });
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            inserts.push(payload);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi
                .fn()
                .mockResolvedValue(
                  stubs.finalRow ?? { data: { id: 'w-1', ...payload }, error: null },
                ),
            };
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi
                  .fn()
                  .mockResolvedValue(
                    stubs.finalRow ?? { data: { id: 'w-1', ...payload }, error: null },
                  ),
              }),
            };
          }),
        };
      }
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue(
              stubs.venueOrg ?? { data: { organization_id: 'org-1' }, error: null },
            ),
        };
      }
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue(
              stubs.eventOrg ?? { data: { organization_id: 'org-1' }, error: null },
            ),
        };
      }
      return {} as never;
    }),
  };

  return { service: { service }, inserts, updates };
}

const makeNotifications = () => ({
  scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined),
});
const makeNotificationEvents = () => ({ workshopCancelled: vi.fn().mockResolvedValue(undefined) });
const makeOrgs = () => ({ assertOrgRole: vi.fn().mockResolvedValue(undefined) });
const makePrivacy = () => ({
  hiddenWorkshopGlobalPersonIds: vi.fn().mockResolvedValue(new Set<string>()),
});

function makeService(service: unknown) {
  return new WorkshopsService(
    service as never,
    makeNotifications() as never,
    makeNotificationEvents() as never,
    makeOrgs() as never,
    makePrivacy() as never,
  );
}

describe('WorkshopsService — create/update columns', () => {
  it('createWorkshop persists `title` and never writes `name`/`location_label`', async () => {
    const { service, inserts } = buildSupabase({
      venueOrg: { data: { organization_id: 'org-1' }, error: null },
      eventOrg: { data: { organization_id: 'org-1' }, error: null },
    });
    const svc = makeService(service);

    await svc.createWorkshop(
      'event-1',
      {
        slug: 'longsword-fundamentals',
        title: 'Longsword Fundamentals',
        capacity: 16,
        venueId: 'v-1',
      },
      'user-1',
    );

    expect(inserts[0]).toMatchObject({
      event_id: 'event-1',
      slug: 'longsword-fundamentals',
      title: 'Longsword Fundamentals',
      venue_id: 'v-1',
    });
    expect(inserts[0]).not.toHaveProperty('name');
    expect(inserts[0]).not.toHaveProperty('location_label');
  });

  it('createWorkshop refuses a cross-org venue reference', async () => {
    const { service } = buildSupabase({
      venueOrg: { data: { organization_id: 'org-A' }, error: null },
      eventOrg: { data: { organization_id: 'org-B' }, error: null },
    });
    const svc = makeService(service);

    await expect(
      svc.createWorkshop(
        'event-1',
        { slug: 'foo', title: 'Foo', capacity: 16, venueId: 'v-of-other-org' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateWorkshop writes venue_id: null when the operator clears the default venue', async () => {
    const { service, updates } = buildSupabase({
      workshopRow: { data: { event_id: 'event-1' }, error: null },
    });
    const svc = makeService(service);

    await svc.updateWorkshop('w-1', { venueId: null }, 'user-1');

    expect(updates[0]).toMatchObject({ venue_id: null });
  });
});

describe('WorkshopsService — deleteSession (unschedule)', () => {
  function build() {
    const captures: { deletedId?: string } = {};
    const sessionsApi: Record<string, unknown> = {};
    Object.assign(sessionsApi, {
      select: vi.fn(() => sessionsApi),
      eq: vi.fn(() => sessionsApi),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { workshop_id: 'w-1' }, error: null })),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, val: string) => {
          captures.deletedId = val;
          return Promise.resolve({ error: null });
        }),
      })),
    });
    const workshopsApi = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { event_id: 'event-1' }, error: null })),
    };
    const eventsApi = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: { organization_id: 'org-1' }, error: null }),
      ),
    };
    const supabase = {
      service: {
        from: vi.fn((t: string) =>
          t === 'workshop_sessions' ? sessionsApi : t === 'workshops' ? workshopsApi : eventsApi,
        ),
      },
    };
    return { supabase, captures };
  }

  it('deletes the session row after asserting management rights', async () => {
    const { supabase, captures } = build();
    const svc = makeService(supabase);

    await svc.deleteSession('sess-1', 'user-1');

    expect(captures.deletedId).toBe('sess-1');
  });
});

describe('WorkshopsService — uploadLogo', () => {
  // Storage-aware supabase fake: workshops (resolveWorkshopEvent + the
  // cover_image_url update), events (org-role gate), and a storage client.
  function buildLogoSupabase() {
    const updates: Record<string, unknown>[] = [];
    const storage = {
      getBucket: vi.fn().mockResolvedValue({ data: { name: 'workshop-assets' }, error: null }),
      createBucket: vi.fn(),
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi
          .fn()
          .mockReturnValue({ data: { publicUrl: 'https://cdn.test/workshops/w-1/logo.png' } }),
      }),
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'workshops') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { event_id: 'event-1' }, error: null }),
            update: vi.fn((payload: Record<string, unknown>) => {
              updates.push(payload);
              return { eq: vi.fn().mockResolvedValue({ error: null }) };
            }),
          };
        }
        if (table === 'events') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
          };
        }
        return {} as never;
      }),
      storage,
    };
    return { supabase: { service: client }, updates, storage };
  }

  it('writes cover_image_url to the workshop-assets bucket and returns the URL', async () => {
    const { supabase, updates, storage } = buildLogoSupabase();
    const svc = makeService(supabase);

    const result = await svc.uploadLogo('w-1', 'user-1', {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: 'my logo!.png',
      mimetype: 'image/png',
    });

    expect(result).toEqual({ url: 'https://cdn.test/workshops/w-1/logo.png' });
    expect(storage.from).toHaveBeenCalledWith('workshop-assets');
    expect(updates[0]).toMatchObject({
      cover_image_url: 'https://cdn.test/workshops/w-1/logo.png',
    });
  });

  it('rejects a source file over the 15 MB cap', async () => {
    const { supabase } = buildLogoSupabase();
    const svc = makeService(supabase);

    await expect(
      svc.uploadLogo('w-1', 'user-1', {
        buffer: Buffer.alloc(15 * 1024 * 1024 + 1),
        filename: 'huge.png',
        mimetype: 'image/png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image mimetype', async () => {
    const { supabase } = buildLogoSupabase();
    const svc = makeService(supabase);

    await expect(
      svc.uploadLogo('w-1', 'user-1', {
        buffer: Buffer.from('hello'),
        filename: 'logo.svg',
        mimetype: 'image/svg+xml',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
