import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsService } from './notification-events.service';
import { makeSupabase } from './notification-events.fixtures';

describe('notification event handlers', () => {
  it('sends assignment changed notifications to the assigned referee', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase({
      referee_assignments: {
        data: {
          id: 'assignment-1',
          person_id: 'person-1',
          role: 'arbitre_table',
          matches: { match_number_label: 'L1-P1-M1' },
        },
        error: null,
      },
      global_persons: { data: { claimed_by_user_id: 'user-1' }, error: null },
    });
    const account = { ok: true, status: 200, data: { id: 'user-1', email: 'ref@example.com' } };
    const service = new NotificationEventsService(
      { ...supabase, getAuthAdminUser: vi.fn().mockResolvedValue(account) } as never,
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
      // The lock's own send keeps the one-send-per-id rule; only the publish resend replaces.
      { replace: false },
    );
  });

  it("sends waitlist promotion notification to the promoted person, naming the session's time", async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase({
      workshop_sessions: {
        data: {
          id: 'session-1',
          // Saturday 14 November 2026, 10:00 in Paris.
          starts_at: '2026-11-14T09:00:00+00:00',
          workshops: { title: 'Messer fundamentals', events: { timezone: 'Europe/Paris' } },
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
    });
    const service = new NotificationEventsService(supabase as never, scheduler as never);

    await service.waitlistPromoted('session-1', 'person-1');

    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'waitlist_promoted',
        entityId: 'session-1',
        userId: 'user-1',
        email: 'promoted@example.com',
        title: 'Place en atelier confirmée / Workshop place confirmed',
        body: "Vous quittez la liste d'attente : votre place est confirmée pour Messer fundamentals, sam. 14 nov., 10:00. / You have been promoted from the waitlist for Messer fundamentals on Sat 14 Nov, 10:00.",
        emailSubject: 'Place en atelier confirmée / Workshop place confirmed',
      }),
    );
    // The double ignores the projection: only this holds the columns the words come from.
    const sessions = supabase.service.from.mock.results[0]?.value as {
      select: ReturnType<typeof vi.fn>;
    };
    expect(sessions.select.mock.calls[0]).toEqual([
      'id, starts_at, workshops ( title, events ( timezone ) )',
    ]);
  });

  it('sends results published notifications to registered fighters', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationEventsService(
      makeSupabase({
        tournaments: {
          data: {
            id: 'tournament-1',
            name: 'Longsword',
            status: 'completed',
            events: { status: 'published', event_kind: 'standard' },
          },
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
              events: { slug: 'spring-open', status: 'running', event_kind: 'standard' },
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
    expect(ada['body']).toBe(
      'Ronde 2 : vous affrontez Alan Turing sur Piste 3. / Round 2: you face Alan Turing on Piste 3.',
    );
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
      "Ronde 2 : vous n'avez pas d'adversaire (exemption). / You have a bye in round 2.",
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
                  events: { slug: 'spring-open', status: 'running', event_kind: 'standard' },
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
