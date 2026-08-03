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

  // ── swiss_round_published ─────────────────────────────────────────────────

  function swissTables(over: Record<string, unknown> = {}) {
    return {
      swiss_rounds: {
        data: {
          id: 'round-1',
          round_number: 2,
          phase_id: 'phase-1',
          bye_registration_id: 'reg-3',
          phases: {
            tournaments: {
              name: 'Longsword',
              slug: 'longsword',
              status: 'running',
              events: { slug: 'spring-open' },
            },
          },
        },
        error: null,
      },
      swiss_entrants: {
        data: [
          {
            registration_id: 'reg-1',
            withdrawn_at_round: null,
            registrations: { person_id: 'p1' },
          },
          {
            registration_id: 'reg-2',
            withdrawn_at_round: null,
            registrations: { person_id: 'p2' },
          },
          {
            registration_id: 'reg-3',
            withdrawn_at_round: null,
            registrations: { person_id: 'p3' },
          },
          // Withdrew before this round — must not be paired OR notified.
          { registration_id: 'reg-4', withdrawn_at_round: 2, registrations: { person_id: 'p4' } },
        ],
        error: null,
      },
      matches: {
        data: [
          {
            red_registration_id: 'reg-1',
            blue_registration_id: 'reg-2',
            lices: { name: 'Piste 3' },
          },
        ],
        error: null,
      },
      registrations: {
        data: [
          { id: 'reg-1', persons: { given_name: 'Ada', family_name: 'Lovelace' } },
          { id: 'reg-2', persons: { given_name: 'Alan', family_name: 'Turing' } },
        ],
        error: null,
      },
      persons: {
        data: [
          { id: 'p1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
          { id: 'p2', claimed_by_user_id: 'user-2', email: 'two@example.com' },
          { id: 'p3', claimed_by_user_id: 'user-3', email: 'three@example.com' },
          { id: 'p4', claimed_by_user_id: 'user-4', email: 'four@example.com' },
        ],
        error: null,
      },
      ...over,
    };
  }

  it('names the opponent and the piste, and deep-links to the Swiss tab', async () => {
    const scheduler = { sendImmediateBulk: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase(swissTables()) as never,
      scheduler as never,
    );

    await service.swissRoundPublished('round-1');

    const jobs = scheduler.sendImmediateBulk.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const ada = jobs.find((job) => job['userId'] === 'user-1')!;
    expect(ada['kind']).toBe('swiss_round_published');
    expect(ada['preference']).toBe('swiss_round_published');
    expect(ada['body']).toBe('Round 2: you face Alan Turing on Piste 3.');
    expect(ada['url']).toBe('/e/spring-open/t/longsword#swiss');
  });

  it('tells the bye holder they have a bye rather than leaving them uninformed', async () => {
    const scheduler = { sendImmediateBulk: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase(swissTables()) as never,
      scheduler as never,
    );

    await service.swissRoundPublished('round-1');

    const jobs = scheduler.sendImmediateBulk.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(jobs.find((job) => job['userId'] === 'user-3')!['body']).toBe(
      'You have a bye in round 2.',
    );
  });

  it('skips a fighter who withdrew before this round', async () => {
    const scheduler = { sendImmediateBulk: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase(swissTables()) as never,
      scheduler as never,
    );

    await service.swissRoundPublished('round-1');

    const jobs = scheduler.sendImmediateBulk.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(jobs.map((job) => job['userId']).sort()).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('stays silent while the tournament is still a draft', async () => {
    const scheduler = { sendImmediateBulk: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase(
        swissTables({
          swiss_rounds: {
            data: {
              id: 'round-1',
              round_number: 1,
              phase_id: 'phase-1',
              bye_registration_id: null,
              phases: {
                tournaments: {
                  name: 'Longsword',
                  slug: 'longsword',
                  status: 'draft',
                  events: { slug: 'spring-open' },
                },
              },
            },
            error: null,
          },
        }),
      ) as never,
      scheduler as never,
    );

    await service.swissRoundPublished('round-1');

    expect(scheduler.sendImmediateBulk).not.toHaveBeenCalled();
  });
});
