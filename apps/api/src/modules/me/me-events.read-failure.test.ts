import { describe, expect, it, vi } from 'vitest';
import { MeEventsService } from './me-events.service';

/**
 * Ruling 461: a read that decides which Events are hers fails the list, never shortens it. A list
 * one read short told a member "not your event" when she sent a photo, and showed her fewer Events
 * with no warning. The detail reads (skills, Swiss rounds, bout counts) are not covered here.
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
  event_kind: 'standard',
  photo_mode: 'live',
  ...over,
});
const READER = { userId: 'user-1', staff: null };
const FAILED = { data: null, error: { message: 'boom' } };

/** Every table answers as for a member of e-1, except `failing`, which errors. */
function serviceWith(failing: string | null, event = EVENT()) {
  const answers: Record<string, unknown> = {
    persons: { data: [{ id: 'p-1', event_id: 'e-1', events: event }], error: null },
    global_persons: { data: { id: 'gp-1' }, error: null },
    events: { data: [{ ...event, organization_id: 'org-1' }], error: null },
  };
  const from = vi.fn((table: string) =>
    q(table === failing ? FAILED : (answers[table] ?? { data: [], error: null })),
  );
  return new MeEventsService({ service: { from } } as never, {} as never, {} as never);
}

describe('MeEventsService.listMyEvents — a failed read fails the list (ruling 461)', () => {
  it.each([
    ['persons', 'claimed roster rows'],
    ['global_persons', 'profile'],
    ['referee_assignments', 'referee duties'],
    ['workshop_enrollments', 'workshop enrolments'],
    ['event_instructors', 'teaching'],
    ['workshop_instructors', 'teaching'],
  ])('a failed %s read fails the list, never shortens it', async (table, what) => {
    await expect(serviceWith(table).listMyEvents(READER)).rejects.toThrow(
      `My events: ${what} not read: boom`,
    );
  });

  it('lists the member when every read answers', async () => {
    const events = await serviceWith(null).listMyEvents(READER);
    expect(events.map((entry) => entry.event.id)).toEqual(['e-1']);
  });
});

/**
 * The same two reads open the personal space's other lists: each answers a failure now, never an
 * empty list (`/me/upcoming`, `/me/leagues`, `/me/workshop-history`, `/me/instructor-workshops`).
 */
describe('the other /me lists share the reads, and fail with them (ruling 461)', () => {
  it.each([
    ['getUpcoming', 'persons', (s: MeEventsService) => s.getUpcoming(READER, 5)],
    ['getMyWorkshopHistory', 'persons', (s: MeEventsService) => s.getMyWorkshopHistory('user-1')],
    ['listMyLeagues', 'global_persons', (s: MeEventsService) => s.listMyLeagues('user-1')],
    [
      'getInstructorWorkshops',
      'global_persons',
      (s: MeEventsService) => s.getInstructorWorkshops('user-1'),
    ],
  ] as const)('%s fails when its %s read fails', async (_name, table, call) => {
    await expect(call(serviceWith(table))).rejects.toThrow('not read: boom');
  });
});

describe('MeEventsService.listMyEvents — the photo mode (slice 6a)', () => {
  it("carries the Event's photo mode", async () => {
    const [entry] = await serviceWith(null).listMyEvents(READER);
    expect(entry?.event.photoMode).toBe('live');
  });

  it('reads an unknown mode as null, never as off', async () => {
    const [entry] = await serviceWith(null, EVENT({ photo_mode: 'banana' })).listMyEvents(READER);
    expect(entry?.event.photoMode).toBeNull();
  });
});
