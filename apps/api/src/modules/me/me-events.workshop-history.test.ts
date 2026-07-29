import { describe, expect, it, vi } from 'vitest';
import { MeEventsService } from './me-events.service';

/**
 * Thenable query chain: `.select().eq().in()` all return the same object, which
 * also resolves (await) to the given result — matching how getMyWorkshopHistory
 * awaits `from(...).select(...).in(...)` directly. Mirrors venues.service.test.
 * The explicit type annotation breaks the self-referential inference cycle.
 */
type Chain = Promise<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
};
function q(result: unknown): Chain {
  const promise = Promise.resolve(result);
  const api: Chain = Object.assign(promise, {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
  });
  return api;
}

const EVENT = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  slug: 'fosse-2027',
  name: 'Fosse aux Lions 2027',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
  status: 'published',
  timezone: 'Europe/Paris',
  event_kind: 'standard',
  ...over,
});

const enrollment = (over: {
  workshopId: string;
  sessionId?: string;
  title?: string;
  weapon?: string | null;
  startsAt?: string | null;
  event?: Record<string, unknown>;
  instructors?: Array<{ global_person_id: string | null; display_name: string }>;
}) => ({
  workshop_sessions: {
    id: over.sessionId ?? `s-${over.workshopId}`,
    starts_at: over.startsAt ?? '2026-06-01T10:00:00Z',
    ends_at: '2026-06-01T12:00:00Z',
    location_label: 'Salle A',
    status: 'scheduled',
    venues: { name: 'Gymnase' },
    venue_areas: null,
    workshops: {
      id: over.workshopId,
      slug: `${over.workshopId}-slug`,
      title: over.title ?? 'Longsword Fundamentals',
      short_description: 'Intro',
      description_md: null,
      category: 'Technique',
      level: 'Beginner',
      weapon: over.weapon === undefined ? 'Longsword' : over.weapon,
      language: 'fr',
      color: 'red',
      cover_image_url: null,
      capacity: 20,
      duration_minutes: 90,
      events: over.event ?? EVENT(),
      workshop_instructors: over.instructors ?? [
        { global_person_id: 'gp-1', display_name: 'Jane Doe' },
      ],
    },
  },
});

function buildService(persons: unknown[], enrollments: unknown[]) {
  const enrollmentsChain = q({ data: enrollments, error: null });
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        if (table === 'persons') return q({ data: persons, error: null });
        if (table === 'workshop_enrollments') return enrollmentsChain;
        return q({ data: null, error: null });
      }),
    },
  };
  const service = new MeEventsService(supabase as never, {} as never);
  return { service, enrollmentsChain };
}

describe('MeEventsService.getMyWorkshopHistory', () => {
  it('returns [] when the user has no claimed persons', async () => {
    const { service } = buildService([], []);
    await expect(service.getMyWorkshopHistory('user-1')).resolves.toEqual([]);
  });

  it('filters enrollments to confirmed + intent (excludes waitlisted/cancelled)', async () => {
    const { service, enrollmentsChain } = buildService(
      [{ id: 'p-1' }],
      [enrollment({ workshopId: 'w-1' })],
    );
    await service.getMyWorkshopHistory('user-1');
    const calls = enrollmentsChain.in.mock.calls as unknown[][];
    const statusCall = calls.find((c) => c[0] === 'status');
    expect(statusCall?.[1]).toEqual(['confirmed', 'intent']);
    const personCall = calls.find((c) => c[0] === 'user_id');
    expect(personCall?.[1]).toEqual(['p-1']);
  });

  it('maps a workshop to the WorkshopListItem shape with weapon + instructors', async () => {
    const { service } = buildService([{ id: 'p-1' }], [enrollment({ workshopId: 'w-1' })]);
    const groups = await service.getMyWorkshopHistory('user-1');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.event).toMatchObject({ id: 'e-1', name: 'Fosse aux Lions 2027' });
    const w = groups[0]!.workshops[0]!;
    expect(w).toMatchObject({ id: 'w-1', weapon: 'Longsword', level: 'Beginner' });
    expect(w.instructors).toEqual([{ globalPersonId: 'gp-1', displayName: 'Jane Doe' }]);
    expect(w.sessions[0]).toMatchObject({ startsAt: '2026-06-01T10:00:00Z', confirmedCount: 0 });
  });

  it('groups by event, most-recent event first', async () => {
    const eventOld = EVENT({ id: 'e-old', name: 'Old', start_date: '2026-01-01' });
    const eventNew = EVENT({ id: 'e-new', name: 'New', start_date: '2026-09-01' });
    const { service } = buildService(
      [{ id: 'p-1' }, { id: 'p-2' }],
      [
        enrollment({ workshopId: 'w-old', event: eventOld }),
        enrollment({ workshopId: 'w-new', event: eventNew }),
      ],
    );
    const groups = await service.getMyWorkshopHistory('user-1');
    expect(groups.map((g) => g.event.id)).toEqual(['e-new', 'e-old']);
  });

  it('dedups the same workshop enrolled via two persons', async () => {
    const { service } = buildService(
      [{ id: 'p-1' }, { id: 'p-2' }],
      [
        enrollment({ workshopId: 'w-1', sessionId: 's-a' }),
        enrollment({ workshopId: 'w-1', sessionId: 's-b' }),
      ],
    );
    const groups = await service.getMyWorkshopHistory('user-1');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workshops).toHaveLength(1);
  });

  it('drops workshops belonging to test events', async () => {
    const testEvent = EVENT({ id: 'e-test', event_kind: 'test' });
    const { service } = buildService(
      [{ id: 'p-1' }],
      [
        enrollment({ workshopId: 'w-real' }),
        enrollment({ workshopId: 'w-test', event: testEvent }),
      ],
    );
    const groups = await service.getMyWorkshopHistory('user-1');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workshops.map((w) => w.id)).toEqual(['w-real']);
  });

  it('sorts workshops within an event by session start', async () => {
    const { service } = buildService(
      [{ id: 'p-1' }],
      [
        enrollment({ workshopId: 'w-late', startsAt: '2026-06-01T15:00:00Z' }),
        enrollment({ workshopId: 'w-early', startsAt: '2026-06-01T09:00:00Z' }),
      ],
    );
    const groups = await service.getMyWorkshopHistory('user-1');
    expect(groups[0]!.workshops.map((w) => w.id)).toEqual(['w-early', 'w-late']);
  });
});
