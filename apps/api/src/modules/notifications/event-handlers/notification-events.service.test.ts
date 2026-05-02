import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsService } from './notification-events.service';

function makeQuery(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    order: vi.fn(),
    limit: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

function makeSupabase(resultsByTable: Record<string, unknown>) {
  return {
    service: {
      from: vi.fn((table: string) =>
        makeQuery(resultsByTable[table] ?? { data: null, error: null }),
      ),
    },
  };
}

describe('notification event handlers', () => {
  it('sends assignment changed notifications to the assigned referee', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({
        referee_assignments: {
          data: {
            id: 'assignment-1',
            person_id: 'person-1',
            role: 'arbitre_table',
            matches: { match_number_label: 'L1-P1-M1' },
          },
          error: null,
        },
        persons: {
          data: {
            id: 'person-1',
            claimed_by_user_id: 'user-1',
            email: 'ref@example.com',
          },
          error: null,
        },
      }) as never,
      scheduler as never,
    );

    await service.assignmentChanged('assignment-1');

    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assignment_changed',
        entityId: 'assignment-1',
        userId: 'user-1',
        email: 'ref@example.com',
        preference: 'schedule_changes',
      }),
    );
  });

  it('sends workshop cancellation notifications to confirmed enrollments', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({
        workshop_sessions: {
          data: {
            id: 'session-1',
            workshops: { title: 'Messer fundamentals' },
          },
          error: null,
        },
        workshop_enrollments: {
          data: [{ person_id: 'person-1' }, { person_id: 'person-2' }],
          error: null,
        },
        persons: {
          data: [
            { id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
            { id: 'person-2', claimed_by_user_id: 'user-2', email: 'two@example.com' },
          ],
          error: null,
        },
      }) as never,
      scheduler as never,
    );

    await service.workshopCancelled('session-1');

    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(2);
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workshop_cancelled', userId: 'user-1' }),
    );
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workshop_cancelled', userId: 'user-2' }),
    );
  });

  it('sends waitlist promotion notification to the promoted person', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({
        workshop_sessions: {
          data: {
            id: 'session-1',
            workshops: { title: 'Messer fundamentals' },
          },
          error: null,
        },
        persons: {
          data: {
            id: 'person-1',
            claimed_by_user_id: 'user-1',
            email: 'promoted@example.com',
          },
          error: null,
        },
      }) as never,
      scheduler as never,
    );

    await service.waitlistPromoted('session-1', 'person-1');

    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'waitlist_promoted',
        entityId: 'session-1',
        userId: 'user-1',
        email: 'promoted@example.com',
      }),
    );
  });

  it('sends results published notifications to registered fighters', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({
        tournaments: {
          data: { id: 'tournament-1', name: 'Longsword' },
          error: null,
        },
        registrations: {
          data: [{ person_id: 'person-1' }, { person_id: 'person-2' }],
          error: null,
        },
        persons: {
          data: [
            { id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
            { id: 'person-2', claimed_by_user_id: 'user-2', email: 'two@example.com' },
          ],
          error: null,
        },
      }) as never,
      scheduler as never,
    );

    await service.resultsPublished('tournament-1');

    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(2);
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'results_published',
        entityId: 'tournament-1',
        userId: 'user-1',
        preference: 'results_published',
      }),
    );
  });
});
