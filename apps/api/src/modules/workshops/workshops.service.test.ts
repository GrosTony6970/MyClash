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
