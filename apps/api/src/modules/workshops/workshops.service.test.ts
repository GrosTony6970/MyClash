/**
 * workshops.service.test.ts
 *
 * Pins the workshop-level venue_id behaviour shipped with the
 * "venues are org-level" plan:
 *
 *   - createWorkshop persists venueId on the insert.
 *   - createWorkshop refuses cross-org venue references.
 *   - updateWorkshop accepts venueId (and `null` to clear).
 *
 * The slug-uniqueness + happy-path inserts are exercised indirectly
 * by the e2e tests; this file is a precise pin on the new
 * cross-org guard so future refactors of `assertVenueBelongsToEventsOrg`
 * don't silently re-open the loophole.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Result<T = unknown> = { data: T | null; error: { message: string } | null };

interface Stubs {
  /** Slug-uniqueness probe. */
  existingSlug?: Result<{ id: string } | null>;
  /** Venue org-id lookup inside assertVenueBelongsToEventsOrg. */
  venueOrg?: Result<{ organization_id: string } | null>;
  /** Event org-id lookup inside assertVenueBelongsToEventsOrg. */
  eventOrg?: Result<{ organization_id: string } | null>;
  /** Workshop row probe used by updateWorkshop when re-validating the venue. */
  workshopRow?: Result<{ event_id: string } | null>;
  /** Final INSERT/UPDATE result. */
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
            // 1st call: slug-uniqueness probe (createWorkshop) OR
            // workshop_row probe (updateWorkshop). Caller decides
            // via stubs.existingSlug / stubs.workshopRow.
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

function makeNotifications() {
  return { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) };
}

function makeNotificationEvents() {
  return { workshopCancelled: vi.fn().mockResolvedValue(undefined) };
}

describe('WorkshopsService — workshop-level venue', () => {
  it('createWorkshop persists venueId on the insert when the venue belongs to the events org', async () => {
    const { service, inserts } = buildSupabase({
      venueOrg: { data: { organization_id: 'org-1' }, error: null },
      eventOrg: { data: { organization_id: 'org-1' }, error: null },
    });
    const svc = new WorkshopsService(
      service as never,
      makeNotifications() as never,
      makeNotificationEvents() as never,
    );

    await svc.createWorkshop('event-1', {
      slug: 'longsword-fundamentals',
      name: 'Longsword Fundamentals',
      capacity: 16,
      venueId: 'v-1',
    });

    expect(inserts[0]).toMatchObject({
      event_id: 'event-1',
      slug: 'longsword-fundamentals',
      name: 'Longsword Fundamentals',
      venue_id: 'v-1',
    });
  });

  it('createWorkshop refuses a cross-org venue reference', async () => {
    const { service } = buildSupabase({
      venueOrg: { data: { organization_id: 'org-A' }, error: null },
      eventOrg: { data: { organization_id: 'org-B' }, error: null },
    });
    const svc = new WorkshopsService(
      service as never,
      makeNotifications() as never,
      makeNotificationEvents() as never,
    );

    await expect(
      svc.createWorkshop('event-1', {
        slug: 'foo',
        name: 'Foo',
        capacity: 16,
        venueId: 'v-of-other-org',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateWorkshop writes venue_id: null when the operator clears the default venue', async () => {
    const { service, updates } = buildSupabase({
      workshopRow: { data: { event_id: 'event-1' }, error: null },
    });
    const svc = new WorkshopsService(
      service as never,
      makeNotifications() as never,
      makeNotificationEvents() as never,
    );

    await svc.updateWorkshop('w-1', { venueId: null });

    expect(updates[0]).toMatchObject({ venue_id: null });
  });
});
