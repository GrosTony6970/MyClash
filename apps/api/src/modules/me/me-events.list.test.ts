import { describe, expect, it, vi } from 'vitest';
import { MeEventsService } from './me-events.service';

/**
 * Thenable query chain: every builder method returns the same object, which
 * also resolves (await) — and via `.maybeSingle()` — to the given result. This
 * mirrors how listMyEvents' fetchers await `from(...).select(...).eq/in(...)`
 * directly (and resolveGlobalPersonId awaits `.maybeSingle()`). Mirrors
 * me-events.workshop-history.test. The explicit type breaks the self-ref cycle.
 */
type Chain = Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
function q(result: unknown): Chain {
  const promise = Promise.resolve(result) as Chain;
  for (const m of ['select', 'eq', 'in', 'neq', 'order', 'or', 'maybeSingle']) {
    promise[m] = vi.fn(() => promise);
  }
  return promise;
}

const EVENT = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  slug: 'fosse-2027',
  name: 'Fosse aux Lions 2027',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
  status: 'published',
  timezone: 'Europe/Paris',
  is_test_event: false,
  ...over,
});

/** A claimed person tying the user to event e-1 (so the event is in the list). */
const CLAIMED_PERSON = { id: 'p-1', event_id: 'e-1', events: EVENT() };

function buildService(opts: {
  persons?: unknown[];
  globalPerson?: { id: string } | null;
  eventInstructors?: unknown[];
  workshopInstructors?: unknown[];
}) {
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        switch (table) {
          case 'persons':
            return q({ data: opts.persons ?? [CLAIMED_PERSON], error: null });
          case 'global_persons':
            return q({
              data: 'globalPerson' in opts ? opts.globalPerson : { id: 'gp-1' },
              error: null,
            });
          case 'event_instructors':
            return q({ data: opts.eventInstructors ?? [], error: null });
          case 'workshop_instructors':
            return q({ data: opts.workshopInstructors ?? [], error: null });
          default:
            // referee_assignments, workshop_enrollments, registrations,
            // tournaments, matches, pool_members — all irrelevant here.
            return q({ data: [], error: null });
        }
      }),
    },
  };
  return new MeEventsService(supabase as never, {} as never);
}

describe('MeEventsService.listMyEvents — isInstructor', () => {
  it('sets isInstructor when the user is on the event instructor roster', async () => {
    const service = buildService({ eventInstructors: [{ events: EVENT() }] });
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.roles.isInstructor).toBe(true);
  });

  it('sets isInstructor when the user leads a workshop at the event', async () => {
    const service = buildService({
      persons: [], // no claimed person — the event comes solely from the workshop lead
      workshopInstructors: [{ workshops: { event_id: 'e-1', events: EVENT() } }],
    });
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.roles).toMatchObject({
      isInstructor: true,
      isCompetitor: false,
      isReferee: false,
      isWorkshopParticipant: false,
    });
  });

  it('exposes the taught workshop (with its session) in workshopsTeaching', async () => {
    const service = buildService({
      persons: [],
      workshopInstructors: [
        {
          workshops: {
            id: 'w-1',
            slug: 'intro-longsword',
            title: 'Intro to Longsword',
            event_id: 'e-1',
            events: EVENT(),
            // UNIQUE(workshop_id) → PostgREST embeds the session as an object.
            workshop_sessions: {
              id: 's-1',
              starts_at: '2026-06-01T09:00:00Z',
              ends_at: '2026-06-01T10:30:00Z',
              location_label: 'Lice 3',
            },
          },
        },
      ],
    });
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.workshopsTeaching).toEqual([
      {
        workshopId: 'w-1',
        workshopSlug: 'intro-longsword',
        workshopName: 'Intro to Longsword',
        sessionStart: '2026-06-01T09:00:00Z',
        sessionEnd: '2026-06-01T10:30:00Z',
        location: 'Lice 3',
      },
    ]);
  });

  it('leaves workshopsTeaching empty for a roster-only instructor (no workshop)', async () => {
    const service = buildService({
      persons: [],
      eventInstructors: [{ events: EVENT() }],
    });
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.roles.isInstructor).toBe(true);
    expect(events[0]!.workshopsTeaching).toEqual([]);
  });

  it('leaves isInstructor false when the user has no instructor role at the event', async () => {
    const service = buildService({}); // claimed person only, no instructor rows
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.roles.isInstructor).toBe(false);
  });

  it('does not crash (isInstructor false) when the user has no global person', async () => {
    const service = buildService({ globalPerson: null, eventInstructors: [{ events: EVENT() }] });
    const events = await service.listMyEvents('user-1');
    // event still present via the claimed person; instructor sources are skipped
    expect(events).toHaveLength(1);
    expect(events[0]!.roles.isInstructor).toBe(false);
  });

  it('drops instructor rows belonging to test events', async () => {
    const service = buildService({
      persons: [],
      eventInstructors: [{ events: EVENT({ id: 'e-test', is_test_event: true }) }],
    });
    const events = await service.listMyEvents('user-1');
    expect(events).toHaveLength(0);
  });
});
