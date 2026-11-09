/**
 * "Workshop cancelled": who is told, and when nobody is (operator rulings, 2026-11-09).
 *
 * A session that will not run tells its confirmed seats and its waitlist: both lose their place.
 * A session never announced (a draft Workshop, a draft or TEST Event) tells nobody. A read that
 * fails throws: read as "nobody booked", a removed session would take the bookings untold.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeSupabase } from './notification-events.fixtures';
import { NotificationEventsService } from './notification-events.service';

/** A Workshop embed that is news: published, in a published standard Event. */
const announced = (extra: Record<string, unknown>, workshop = 'published', event = {}) => ({
  ...extra,
  status: workshop,
  events: { status: 'published', event_kind: 'standard', ...event },
});
const ANNOUNCED_SESSION = {
  workshop_sessions: { data: { workshops: announced({ title: 'Messer' }) }, error: null },
};

describe('the cancel notice of a Workshop session', () => {
  it('sends workshop cancellation notifications to confirmed and waitlisted enrollments', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase({
      workshop_sessions: {
        data: { id: 'session-1', workshops: announced({ title: 'Messer fundamentals' }) },
        error: null,
      },
      workshop_enrollments: {
        // user_id holds the persons.id (the enrollee identity).
        data: [{ user_id: 'person-1' }, { user_id: 'person-2' }],
        error: null,
      },
      persons: {
        data: [
          { id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
          { id: 'person-2', claimed_by_user_id: 'user-2', email: 'two@example.com' },
        ],
        error: null,
      },
    });
    const service = new NotificationEventsService(supabase as never, scheduler as never);

    await service.workshopCancelled('session-1');

    // The double ignores the filter: only this holds who is told. A place on the waitlist is
    // lost too, so its holder is told with the confirmed seats.
    const bookings = supabase.service.from.mock.results.find(
      (_r, i) => supabase.service.from.mock.calls[i]?.[0] === 'workshop_enrollments',
    )?.value as { in: ReturnType<typeof vi.fn> };
    expect(bookings.in.mock.calls).toEqual([['status', ['confirmed', 'waitlisted']]]);
    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(2);
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workshop_cancelled',
        userId: 'user-1',
        title: 'Atelier annulé / Workshop cancelled',
        body: 'Annulé : Messer fundamentals. / Messer fundamentals was cancelled.',
        emailSubject: 'Atelier annulé / Workshop cancelled',
      }),
    );
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workshop_cancelled', userId: 'user-2' }),
    );
  });

  it.each([
    ['the bookings', { workshop_enrollments: { data: null, error: { message: 'reset' } } }],
    [
      'the contacts',
      {
        workshop_enrollments: { data: [{ user_id: 'person-1' }], error: null },
        persons: { data: null, error: { message: 'reset' } },
      },
    ],
  ])('throws when %s cannot be read, telling nobody', async (_what, tables) => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({ ...ANNOUNCED_SESSION, ...tables }) as never,
      scheduler as never,
    );

    await expect(service.workshopCancelled('session-1')).rejects.toThrow(/unreadable: reset/);
    expect(scheduler.sendImmediate).not.toHaveBeenCalled();
  });

  it.each([
    ['a draft Workshop', announced({}, 'draft')],
    ['a Workshop of a draft Event', announced({}, 'published', { status: 'draft' })],
    ['a Workshop of a test Event', announced({}, 'published', { event_kind: 'test' })],
    ['a session read without its statuses', null],
  ])('tells nobody for %s, reading no booking', async (_what, workshops) => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase({
      workshop_sessions: { data: { workshops }, error: null },
      workshop_enrollments: { data: [{ user_id: 'person-1' }], error: null },
    });
    const service = new NotificationEventsService(supabase as never, scheduler as never);

    await service.workshopCancelled('session-1');

    expect(scheduler.sendImmediate).not.toHaveBeenCalled();
    expect(supabase.service.from.mock.calls.map(([t]) => t)).toEqual(['workshop_sessions']);
  });

  it('reads the statuses it decides by', async () => {
    const supabase = makeSupabase(ANNOUNCED_SESSION);
    const service = new NotificationEventsService(
      supabase as never,
      { sendImmediate: vi.fn() } as never,
    );
    await service.workshopCancelled('session-1');
    // The double ignores the projection: only this holds the columns `isWorkshopNews` reads.
    const sessions = supabase.service.from.mock.results[0]?.value as {
      select: ReturnType<typeof vi.fn>;
    };
    expect(sessions.select.mock.calls[0]).toEqual([
      'workshops(status, events(status, event_kind))',
    ]);
  });

  it('calls a Workshop whose title cannot be read "your workshop", in each language', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase({
      // The statuses read, the title not.
      workshop_sessions: { data: { workshops: announced({}) }, error: null },
      workshop_enrollments: { data: [{ user_id: 'person-1' }], error: null },
      persons: {
        data: [{ id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' }],
        error: null,
      },
    });
    const service = new NotificationEventsService(supabase as never, scheduler as never);

    await service.workshopCancelled('session-1');

    expect(scheduler.sendImmediate.mock.calls).toEqual([
      [
        expect.objectContaining({
          body: 'Annulé : votre atelier. / Your workshop was cancelled.',
        }),
      ],
    ]);
  });
});
