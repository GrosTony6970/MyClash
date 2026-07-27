import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';

const fromMock = vi.fn();
const assertOrgRole = vi.fn();

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.neq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  return chain;
}

function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    is: vi.fn(),
    or: vi.fn(),
    limit: vi.fn(),
    lt: vi.fn(),
    gte: vi.fn(),
    ilike: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });
  for (const key of [
    'select',
    'eq',
    'in',
    'neq',
    'order',
    'is',
    'or',
    'limit',
    'lt',
    'gte',
    'ilike',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// Awaitable AND chainable AND terminable (maybeSingle/single/delete) — resolves
// to `result` however the query ends. Handy for multi-query flows like the
// ordered event teardown.
function makeFullChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<
    string,
    ReturnType<typeof vi.fn>
  > &
    Promise<unknown>;
  for (const key of [
    'select',
    'eq',
    'in',
    'neq',
    'order',
    'is',
    'or',
    'limit',
    'lt',
    'delete',
    'insert',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  (chain as unknown as Record<string, unknown>)['maybeSingle'] = vi.fn().mockResolvedValue(result);
  (chain as unknown as Record<string, unknown>)['single'] = vi.fn().mockResolvedValue(result);
  return chain as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

// The public read-paths now resolve a ruleset label (resolveRulesetLabel →
// custom_rulesets) and disclose any mid-event re-pin (loadLatestRulesetRepin →
// tournament_ruleset_repins) as order-independent SIDE lookups. Threading them
// through each test's carefully-sequenced mockReturnValueOnce queue is brittle:
// a single misaligned/overflowing query throws mid-test, and vi.clearAllMocks()
// clears call history but NOT the pending once-queue, so the leftover chains
// corrupt every downstream test. These tables carry no fixture in the read-path
// tests, so we intercept them by NAME and answer "nothing custom" (→ built-in
// label, no re-pin) while the real business queries drain from an ordered queue.
const RULESET_RESOLUTION_TABLES = new Set([
  'custom_rulesets',
  'custom_ruleset_versions',
  'penalty_rulesets',
  'tournament_ruleset_repins',
]);

// A supabase.from() dispatcher: business queries come off `queue` in order
// (preserving each test's sequenced returns), ruleset-resolution lookups are
// answered by name so adding/removing a side-query never shifts the queue.
function dispatchWithRulesetResolution(queue: unknown[]) {
  return (table: string): unknown => {
    if (RULESET_RESOLUTION_TABLES.has(table)) return makeFullChain({ data: null, error: null });
    return queue.shift() ?? makeAwaitableChain({ data: [], error: null });
  };
}

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
    );
  });

  it('hard deletes an event after org admin authorization', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    // No tournaments → the result-graph teardown is skipped.
    const tournamentsChain = makeChain({ data: [], error: null });
    const refereeChain = makeChain({ data: null, error: null }); // referee_assignments clear
    const deleteChain = makeChain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(eventChain)
      .mockReturnValueOnce(tournamentsChain)
      .mockReturnValueOnce(refereeChain)
      .mockReturnValueOnce(deleteChain);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).resolves.toEqual({
      deleted: true,
      id: 'event-1',
    });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'event-1');
  });

  it('hard delete refuses when the event has recorded match results', async () => {
    const byTable: Record<string, unknown> = {
      events: makeFullChain({
        data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
        error: null,
      }),
      tournaments: makeFullChain({ data: [{ id: 't1' }], error: null }),
      phases: makeFullChain({ data: [{ id: 'p1' }], error: null }),
      matches: makeFullChain({ count: 1, error: null }), // one match past 'scheduled'
    };
    fromMock.mockImplementation((table: string) => byTable[table]);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('hard delete tears down forfeits/matches/registrations before deleting the event', async () => {
    const eventsChain = makeFullChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    const matchesChain = makeFullChain({ count: 0, data: [], error: null }); // scheduled-only
    const forfeitsChain = makeFullChain({ data: null, error: null });
    const registrationsChain = makeFullChain({ data: null, error: null });
    const refereeChain = makeFullChain({ data: null, error: null });
    const byTable: Record<string, unknown> = {
      events: eventsChain,
      tournaments: makeFullChain({ data: [{ id: 't1' }], error: null }),
      phases: makeFullChain({ data: [{ id: 'p1' }], error: null }),
      pools: makeFullChain({ data: [{ id: 'pool1' }], error: null }),
      matches: matchesChain,
      referee_assignments: refereeChain,
      match_forfeits: forfeitsChain,
      registrations: registrationsChain,
    };
    fromMock.mockImplementation((table: string) => byTable[table]);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).resolves.toEqual({
      deleted: true,
      id: 'event-1',
    });
    // Referee assignments + result graph cleared first, then the event deleted.
    expect(refereeChain['delete']).toHaveBeenCalled();
    expect(forfeitsChain['delete']).toHaveBeenCalled();
    expect(matchesChain['delete']).toHaveBeenCalled();
    expect(registrationsChain['delete']).toHaveBeenCalled();
    expect(eventsChain['delete']).toHaveBeenCalled();
  });

  it('refuses event delete without explicit hard mode', async () => {
    await expect(service.deleteEvent('event-1', undefined, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('keeps org authorization failures fatal during hard delete', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockRejectedValue(new ForbiddenException('Requires admin role or higher'));

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns event dashboard stats with tournament, fighter, referee, and club counts', async () => {
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
      undefined,
      {} as never,
    );
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'event-1',
            organization_id: 'org-1',
            status: 'published',
            name: 'FAL',
            slug: 'fal',
            start_date: '2026-06-01',
            end_date: '2026-06-02',
            city: 'Lyon',
            country: 'FR',
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'tournament-1',
              slug: 'longsword',
              name: 'Longsword',
              status: 'draft',
              color: 'amber',
              ruleset_code: 'TF_v1',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { tournament_id: 'tournament-1', person_id: 'person-1', status: 'registered' },
            { tournament_id: 'tournament-1', person_id: 'person-2', status: 'withdrawn' },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'person-1',
              given_name: 'Ada',
              family_name: 'Blade',
              email: 'ada@example.test',
              club_id: 'club-1',
              claim_status: 'claimed',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ person_id: 'ref-1' }, { person_id: 'ref-1' }, { person_id: 'ref-2' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      // NEW: getPhasesForTournaments — empty in this fixture so no pools
      // count query follows. Per-tournament poolCount=0, bracketSize=null.
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.getEventDashboardStats('event-1', 'user-1')).resolves.toMatchObject({
      totals: {
        tournaments: 1,
        registeredFighters: 1,
        uniqueFighters: 1,
        uniqueReferees: 2,
        clubsRepresented: 1,
      },
      tournaments: [
        {
          id: 'tournament-1',
          fighterCount: 1,
          assignedRefereeCount: 0,
          color: 'amber',
          rulesetCode: 'TF_v1',
          poolCount: 0,
          bracketSize: null,
          eliminationType: null,
        },
      ],
    });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'scorekeeper');
  });

  it('getEventUniqueParticipantCounts dedupes fighters by global identity + distinct qualified referees', async () => {
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
      undefined,
      {} as never,
    );
    fromMock
      // getEventTournaments
      .mockReturnValueOnce(
        makeAwaitableChain({ data: [{ id: 'tournament-1' }, { id: 'tournament-2' }], error: null }),
      )
      // getRegistrationsForTournaments — one human (global g-1) registered in
      // both tournaments via two person rows, person-2 once, person-3 withdrawn.
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { tournament_id: 'tournament-1', person_id: 'person-1', status: 'registered' },
            { tournament_id: 'tournament-2', person_id: 'person-1b', status: 'registered' },
            { tournament_id: 'tournament-1', person_id: 'person-2', status: 'registered' },
            { tournament_id: 'tournament-1', person_id: 'person-3', status: 'withdrawn' },
          ],
          error: null,
        }),
      )
      // getEventPersons — person-1 and person-1b share global_person_id g-1.
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { id: 'person-1', global_person_id: 'g-1' },
            { id: 'person-1b', global_person_id: 'g-1' },
            { id: 'person-2', global_person_id: null },
            { id: 'person-3', global_person_id: 'g-3' },
          ],
          error: null,
        }),
      )
      // getRefereeQualificationPersons — ref-1 qualified for two roles, ref-2 one.
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ person_id: 'ref-1' }, { person_id: 'ref-1' }, { person_id: 'ref-2' }],
          error: null,
        }),
      );

    await expect(service.getEventUniqueParticipantCounts('event-1')).resolves.toEqual({
      uniqueFighters: 2, // {g-1, person-2}; person-3 withdrawn is excluded
      uniqueReferees: 2, // {ref-1, ref-2}
    });
  });

  it('exposes per-tournament max_participants / max_waitlist + waitlistedCount + event totals', async () => {
    // New dashboard cards (Participants, Waitlist) need cap fields on
    // every tournament row plus null-aware sums on the totals object.
    // Tournament A has caps; Tournament B does not — total caps
    // therefore equal A's caps. The waitlisted count is filtered out
    // of the registered total.
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
      undefined,
      {} as never,
    );
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'event-1',
            organization_id: 'org-1',
            status: 'published',
            name: 'FAL',
            slug: 'fal',
            start_date: '2026-06-01',
            end_date: '2026-06-02',
            city: 'Lyon',
            country: 'FR',
          },
          error: null,
        }),
      )
      // getEventTournaments — two tournaments, only A has caps
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'tournament-a',
              slug: 'longsword',
              name: 'Longsword',
              status: 'published',
              color: 'amber',
              ruleset_code: 'TF_v1',
              max_participants: 32,
              max_waitlist: 10,
            },
            {
              id: 'tournament-b',
              slug: 'rapier',
              name: 'Rapier',
              status: 'draft',
              color: 'rose',
              ruleset_code: 'TF_v1',
              max_participants: null,
              max_waitlist: null,
            },
          ],
          error: null,
        }),
      )
      // getRegistrationsForTournaments — A: 12 active + 2 waitlist;
      // B: 4 active, 0 waitlist. Total registered (active) = 16.
      // Total waitlisted = 2.
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            ...Array.from({ length: 12 }, (_, i) => ({
              tournament_id: 'tournament-a',
              person_id: `person-a-${i}`,
              status: 'registered',
            })),
            { tournament_id: 'tournament-a', person_id: 'person-wl-1', status: 'waitlist' },
            { tournament_id: 'tournament-a', person_id: 'person-wl-2', status: 'waitlist' },
            ...Array.from({ length: 4 }, (_, i) => ({
              tournament_id: 'tournament-b',
              person_id: `person-b-${i}`,
              status: 'registered',
            })),
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
    assertOrgRole.mockResolvedValue(undefined);

    const result = await service.getEventDashboardStats('event-1', 'user-1');

    expect(result.totals).toMatchObject({
      registeredFighters: 16,
      waitlistedFighters: 2,
      maxParticipants: 32, // sum of capped tournaments only (A's 32)
      maxWaitlist: 10,
    });
    expect(result.tournaments).toMatchObject([
      {
        id: 'tournament-a',
        fighterCount: 12,
        waitlistedCount: 2,
        maxParticipants: 32,
        maxWaitlist: 10,
      },
      {
        id: 'tournament-b',
        fighterCount: 4,
        waitlistedCount: 0,
        maxParticipants: null,
        maxWaitlist: null,
      },
    ]);
  });

  it('returns null for totals.maxParticipants/maxWaitlist when every tournament is uncapped', async () => {
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
      undefined,
      {} as never,
    );
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: { id: 'event-1', organization_id: 'org-1', status: 'published' },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'tournament-a',
              slug: 'a',
              name: 'A',
              status: 'draft',
              color: null,
              ruleset_code: null,
              max_participants: null,
              max_waitlist: null,
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
    assertOrgRole.mockResolvedValue(undefined);

    const result = await service.getEventDashboardStats('event-1', 'user-1');

    expect(result.totals.maxParticipants).toBeNull();
    expect(result.totals.maxWaitlist).toBeNull();
    expect(result.totals.waitlistedFighters).toBe(0);
  });

  it('lists all clubs with selected-event fighter context', async () => {
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: { id: 'event-1', organization_id: 'org-1', status: 'published' },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'person-1',
              given_name: 'Ada',
              family_name: 'Blade',
              email: 'ada@example.test',
              club_id: 'club-1',
              claim_status: 'claimed',
              global_person_id: null,
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAMHE' },
            { id: 'club-2', name: 'Dijon Fencing', abbreviation: 'DFDA' },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        // global_persons.select('...').in('club_id', clubIds) — no globals
        // in this fixture, just an event-only fighter.
        makeAwaitableChain({ data: [], error: null }),
      );
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.listEventClubs('event-1', { scope: 'all' }, 'user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'club-1', eventFighterCount: 1 }),
      expect.objectContaining({ id: 'club-2', eventFighterCount: 0 }),
    ]);
  });

  it('listEventClubs merges global club members with event roster and flags inEvent', async () => {
    fromMock
      .mockReturnValueOnce(
        // getEventById
        makeChain({
          data: { id: 'event-1', organization_id: 'org-1', status: 'published' },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        // getEventPersons — Alice is linked to global G1; Bob is event-only.
        makeAwaitableChain({
          data: [
            {
              id: 'person-alice',
              given_name: 'Alice',
              family_name: 'A',
              email: 'alice@example.test',
              club_id: 'club-1',
              claim_status: 'claimed',
              global_person_id: 'G1',
            },
            {
              id: 'person-bob',
              given_name: 'Bob',
              family_name: 'B',
              email: 'bob@example.test',
              club_id: 'club-1',
              claim_status: 'guest_active',
              global_person_id: null,
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        // getClubsForEventScope — single club with both global + event members.
        makeAwaitableChain({
          data: [{ id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAMHE' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        // global_persons for club-1: Alice (G1) is in the event; Carol (G2) is not.
        makeAwaitableChain({
          data: [
            {
              id: 'G1',
              club_id: 'club-1',
              given_name: 'Alice',
              family_name: 'A',
              email: 'alice@example.test',
            },
            {
              id: 'G2',
              club_id: 'club-1',
              given_name: 'Carol',
              family_name: 'C',
              email: 'carol@example.test',
            },
          ],
          error: null,
        }),
      );
    assertOrgRole.mockResolvedValue(undefined);

    const result = await service.listEventClubs('event-1', { scope: 'all' }, 'user-1');

    const club = result[0] as {
      id: string;
      eventFighterCount: number;
      fighters: Array<{ id: string; inEvent: boolean; givenName: string }>;
    };
    expect(club.id).toBe('club-1');
    // eventFighterCount counts ONLY event-roster persons (preserved).
    expect(club.eventFighterCount).toBe(2);
    // Fighters list: G1 (Alice in event), G2 (Carol not in event), Bob (event-only,
    // no global link). Note: dedup means G1 appears once, not twice.
    expect(club.fighters).toEqual([
      expect.objectContaining({ id: 'G1', givenName: 'Alice', inEvent: true }),
      expect.objectContaining({ id: 'G2', givenName: 'Carol', inEvent: false }),
      expect.objectContaining({ id: 'person-bob', givenName: 'Bob', inEvent: true }),
    ]);
  });

  // ── deleteEvent lifecycle protection ─────────────────────────────────────

  it('deleteEvent throws ForbiddenException when event.status === "archived"', async () => {
    // getEventById returns an archived event
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'archived' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
    // assertOrgRole should NOT have been called — we block before auth check
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  // ── deleteTournament lifecycle protection ─────────────────────────────────

  it('deleteTournament throws ForbiddenException when status is "running"', async () => {
    const tournamentChain = makeChain({
      data: { event_id: 'event-1', status: 'running' },
      error: null,
    });
    fromMock.mockReturnValueOnce(tournamentChain);

    await expect(service.deleteTournament('tourn-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('deleteTournament throws ForbiddenException when status is "completed"', async () => {
    const tournamentChain = makeChain({
      data: { event_id: 'event-1', status: 'completed' },
      error: null,
    });
    fromMock.mockReturnValueOnce(tournamentChain);

    await expect(service.deleteTournament('tourn-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('deleteTournament throws ForbiddenException when status is "archived"', async () => {
    const tournamentChain = makeChain({
      data: { event_id: 'event-1', status: 'archived' },
      error: null,
    });
    fromMock.mockReturnValueOnce(tournamentChain);

    await expect(service.deleteTournament('tourn-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('deleteTournament throws ForbiddenException when a draft tournament has scored matches', async () => {
    // 1. Fetch tournament row (draft) — uses .maybeSingle() → makeChain
    const tournamentChain = makeChain({
      data: { event_id: 'event-1', status: 'draft' },
      error: null,
    });
    // 2. Fetch phases — service awaits the chain directly (no .maybeSingle)
    const phasesChain = makeAwaitableChain({ data: [{ id: 'phase-1' }], error: null });
    // 3. Count scored matches — service awaits the chain directly (head:true, no terminal method)
    const matchesChain = makeAwaitableChain({ count: 2, error: null });

    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phasesChain)
      .mockReturnValueOnce(matchesChain);

    await expect(service.deleteTournament('tourn-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('submits an unverified club review request for organizer-created clubs', async () => {
    const clubs = {
      createUnverified: vi.fn().mockResolvedValue({ id: 'club-1', name: 'New Club' }),
    };
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
      undefined,
      clubs as never,
    );
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeChain({
          data: { id: 'request-1', proposed_club_id: 'club-1', status: 'pending' },
          error: null,
        }),
      );
    assertOrgRole.mockResolvedValue(undefined);

    await expect(
      service.submitClubReviewRequest('event-1', { name: 'New Club' }, 'user-1'),
    ).resolves.toMatchObject({
      club: { id: 'club-1' },
      request: { id: 'request-1', status: 'pending' },
    });
    expect(clubs.createUnverified).toHaveBeenCalledWith({ name: 'New Club' });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
  });

  // ── R1: events-list overhaul ─────────────────────────────────────────────

  it('createEvent stamps created_by_user_id with the actor on insert', async () => {
    // 1) slug-uniqueness probe — no existing event with that slug
    const slugProbe = makeChain({ data: null, error: null });
    // 2) insert — capture payload via assertion in the .single() mock
    const insertChain = makeChain({
      data: { id: 'event-1', slug: 'fal-2026', created_by_user_id: 'user-7' },
      error: null,
    });
    fromMock.mockReturnValueOnce(slugProbe).mockReturnValueOnce(insertChain);
    assertOrgRole.mockResolvedValue(undefined);

    await service.createEvent(
      'org-1',
      {
        name: 'FAL 2026',
        slug: 'fal-2026',
        startDate: '2026-03-14',
        endDate: '2026-03-15',
      },
      'user-7',
    );

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        slug: 'fal-2026',
        created_by_user_id: 'user-7',
      }),
    );
  });

  it('updateEvent writes a new slug after an org-scoped uniqueness probe (excluding self)', async () => {
    // 1) getEventById → current draft event
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    // 2) slug-uniqueness probe — no OTHER event in the org owns it
    const slugProbe = makeChain({ data: null, error: null });
    // 3) update(...).eq(...).select(...).single() → returns the updated row
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: 'event-1', slug: 'fosse-aux-lions-2027' }, error: null }),
    };
    fromMock
      .mockReturnValueOnce(eventChain)
      .mockReturnValueOnce(slugProbe)
      .mockReturnValueOnce(updateChain);
    assertOrgRole.mockResolvedValue(undefined);

    await service.updateEvent('event-1', { slug: 'fosse-aux-lions-2027' }, 'user-7');

    // Probe is scoped to the org + requested slug and excludes the event itself.
    expect(slugProbe.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(slugProbe.eq).toHaveBeenCalledWith('slug', 'fosse-aux-lions-2027');
    expect(slugProbe.neq).toHaveBeenCalledWith('id', 'event-1');
    // Slug is written on the update.
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'fosse-aux-lions-2027' }),
    );
  });

  it('updateEvent rejects a slug already used by another event in the org', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    // Probe finds a DIFFERENT event already holding the slug → conflict.
    const slugProbe = makeChain({ data: { id: 'event-2' }, error: null });
    fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(slugProbe);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(
      service.updateEvent('event-1', { slug: 'fosse-aux-lions-2027' }, 'user-7'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('listOrgEvents enriches rows with distinct participant_count per event', async () => {
    // event-1 has 2 tournaments (t-1, t-2). Person p-1 registered to BOTH;
    // p-2 only to t-1; p-3 to t-2. Distinct people = 3. Status filter
    // matches the assertCapacity semantics — withdrawn rows ignored.
    // event-2 has 1 tournament (t-3) with one registered person.
    const eventsChain = makeAwaitableChain({
      data: [
        { id: 'event-1', name: 'FAL 2026' },
        { id: 'event-2', name: 'Other event' },
      ],
      error: null,
    });
    // No creator ids on the events → resolveUserNames short-circuits
    // without touching the global_persons table, so we only mock the
    // events + tournaments + registrations chains.
    const tournamentsChain = makeAwaitableChain({
      data: [
        { id: 't-1', event_id: 'event-1' },
        { id: 't-2', event_id: 'event-1' },
        { id: 't-3', event_id: 'event-2' },
      ],
      error: null,
    });
    const registrationsChain = makeAwaitableChain({
      data: [
        { tournament_id: 't-1', person_id: 'p-1' },
        { tournament_id: 't-1', person_id: 'p-2' },
        { tournament_id: 't-2', person_id: 'p-1' }, // dedup target
        { tournament_id: 't-2', person_id: 'p-3' },
        { tournament_id: 't-3', person_id: 'p-4' },
      ],
      error: null,
    });
    fromMock
      .mockReturnValueOnce(eventsChain)
      .mockReturnValueOnce(tournamentsChain)
      .mockReturnValueOnce(registrationsChain);
    assertOrgRole.mockResolvedValue(undefined);

    const result = (await service.listOrgEvents('org-1', 'user-1')) as Array<{
      id: string;
      participant_count: number;
    }>;

    expect(result.find((r) => r.id === 'event-1')?.participant_count).toBe(3);
    expect(result.find((r) => r.id === 'event-2')?.participant_count).toBe(1);
    // The dedup case is the critical one — same person in two tournaments
    // counts once, not twice.
    expect(result.find((r) => r.id === 'event-1')?.participant_count).not.toBe(4);
    // Registrations filtered to registered/checked_in only.
    expect(registrationsChain.in).toHaveBeenCalledWith('status', ['registered', 'checked_in']);
  });

  it('listOrgEvents enriches rows with creator name + tournament_count', async () => {
    // 1) events query — two events, one with a creator, one without.
    const eventsChain = makeAwaitableChain({
      data: [
        {
          id: 'event-1',
          name: 'FAL 2026',
          created_by_user_id: 'user-7',
        },
        {
          id: 'event-2',
          name: 'Legacy event (pre-creator)',
          created_by_user_id: null,
        },
      ],
      error: null,
    });
    // 2) global_persons query — resolves user-7 to "Tony Stark".
    const globalPersonsChain = makeAwaitableChain({
      data: [{ claimed_by_user_id: 'user-7', given_name: 'Tony', family_name: 'Stark' }],
      error: null,
    });
    // 3) tournaments query — event-1 has 2 tournaments, event-2 has 0.
    const tournamentsChain = makeAwaitableChain({
      data: [{ event_id: 'event-1' }, { event_id: 'event-1' }],
      error: null,
    });
    fromMock
      .mockReturnValueOnce(eventsChain)
      .mockReturnValueOnce(globalPersonsChain)
      .mockReturnValueOnce(tournamentsChain);
    assertOrgRole.mockResolvedValue(undefined);

    const result = (await service.listOrgEvents('org-1', 'user-1')) as Array<{
      id: string;
      created_by_user_name: string | null;
      tournament_count: number;
    }>;

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'scorekeeper');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'event-1',
        created_by_user_name: 'Tony Stark',
        tournament_count: 2,
      }),
      expect.objectContaining({
        id: 'event-2',
        created_by_user_name: null,
        tournament_count: 0,
      }),
    ]);
  });

  it('listOrgEvents falls back to auth admin display_name when global_persons is empty', async () => {
    const eventsChain = makeAwaitableChain({
      data: [{ id: 'event-1', created_by_user_id: 'user-ops' }],
      error: null,
    });
    // global_persons returns nothing — user-ops is an org admin with no
    // fighter record.
    const globalPersonsChain = makeAwaitableChain({ data: [], error: null });
    const tournamentsChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(eventsChain)
      .mockReturnValueOnce(globalPersonsChain)
      .mockReturnValueOnce(tournamentsChain);
    const getUserById = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'user-ops',
          email: 'ops@example.com',
          user_metadata: { display_name: 'Operations' },
        },
      },
      error: null,
    });
    service = new EventsService(
      { service: { from: fromMock, auth: { admin: { getUserById } } } } as never,
      { assertOrgRole } as never,
      {} as never,
    );
    assertOrgRole.mockResolvedValue(undefined);

    const result = (await service.listOrgEvents('org-1', 'user-1')) as Array<{
      created_by_user_name: string | null;
    }>;

    expect(getUserById).toHaveBeenCalledWith('user-ops');
    expect(result[0]?.created_by_user_name).toBe('Operations');
  });

  it('listOrgEvents falls back to auth admin email when display_name is missing', async () => {
    const eventsChain = makeAwaitableChain({
      data: [{ id: 'event-1', created_by_user_id: 'user-bare' }],
      error: null,
    });
    const globalPersonsChain = makeAwaitableChain({ data: [], error: null });
    const tournamentsChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(eventsChain)
      .mockReturnValueOnce(globalPersonsChain)
      .mockReturnValueOnce(tournamentsChain);
    const getUserById = vi.fn().mockResolvedValue({
      data: {
        user: { id: 'user-bare', email: 'bare@example.com', user_metadata: {} },
      },
      error: null,
    });
    service = new EventsService(
      { service: { from: fromMock, auth: { admin: { getUserById } } } } as never,
      { assertOrgRole } as never,
      {} as never,
    );
    assertOrgRole.mockResolvedValue(undefined);

    const result = (await service.listOrgEvents('org-1', 'user-1')) as Array<{
      created_by_user_name: string | null;
    }>;

    expect(result[0]?.created_by_user_name).toBe('bare@example.com');
  });

  it('uploadLogo writes logo_url and returns the public URL', async () => {
    // 1) getEventById
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    // 2) update events.logo_url — .update(...).eq(...) returns an awaitable
    //    result. Mock both update + eq returning a thenable.
    const updateResult = Promise.resolve({ data: null, error: null });
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue(updateResult),
    };
    fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(updateChain);
    assertOrgRole.mockResolvedValue(undefined);

    const storage = {
      getBucket: vi.fn().mockResolvedValue({ data: { name: 'event-assets' }, error: null }),
      createBucket: vi.fn(),
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi
          .fn()
          .mockReturnValue({ data: { publicUrl: 'https://cdn.test/events/event-1/logo.png' } }),
      }),
    };
    service = new EventsService(
      { service: { from: fromMock, storage } } as never,
      { assertOrgRole } as never,
      {} as never,
    );

    const result = await service.uploadLogo('event-1', 'user-1', {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: 'logo.png',
      mimetype: 'image/png',
    });

    expect(result).toEqual({ url: 'https://cdn.test/events/event-1/logo.png' });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(storage.from).toHaveBeenCalledWith('event-assets');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: 'https://cdn.test/events/event-1/logo.png' }),
    );
  });

  it('uploadLogo rejects non-image mimetypes', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(
      service.uploadLogo('event-1', 'user-1', {
        buffer: Buffer.from('hello'),
        filename: 'logo.svg',
        mimetype: 'image/svg+xml',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── uploadHero ──────────────────────────────────────────────────────
  // The hero image is stored on `themes.hero_image_url` (NOT
  // `events.hero_image_url`) — so unlike uploadLogo the post-write
  // path is an upsert into the themes table, not a direct events
  // update. Locking these tracer bullets keeps the contract clear:
  // bucket path uses the `hero-` prefix, themes upsert carries
  // `hero_image_url`, MIME + size guards reject the same payloads
  // uploadLogo does, and the org-admin role gate fires before the
  // buffer is read.

  it('uploadHero writes themes.hero_image_url and returns the public URL', async () => {
    // 1) getEventById
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    // 2) themes existing-row check — returns null so we INSERT
    const themesSelectChain = makeChain({ data: null, error: null });
    themesSelectChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    // 3) themes insert — used to capture the payload
    const themesInsertResult = Promise.resolve({ data: null, error: null });
    const themesInsertChain = {
      insert: vi.fn().mockReturnValue(themesInsertResult),
    };
    fromMock
      .mockReturnValueOnce(eventChain)
      .mockReturnValueOnce(themesSelectChain)
      .mockReturnValueOnce(themesInsertChain);
    assertOrgRole.mockResolvedValue(undefined);

    const storage = {
      getBucket: vi.fn().mockResolvedValue({ data: { name: 'event-assets' }, error: null }),
      createBucket: vi.fn(),
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi
          .fn()
          .mockReturnValue({ data: { publicUrl: 'https://cdn.test/events/event-1/hero.png' } }),
      }),
    };
    service = new EventsService(
      { service: { from: fromMock, storage } } as never,
      { assertOrgRole } as never,
      {} as never,
    );

    const result = await service.uploadHero('event-1', 'user-1', {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: 'hero.png',
      mimetype: 'image/png',
    });

    expect(result).toEqual({ url: 'https://cdn.test/events/event-1/hero.png' });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(storage.from).toHaveBeenCalledWith('event-assets');
    // Storage path uses the hero- prefix so it sits next to logos
    // under events/<id>/ without clobbering them.
    const storageUploadMock = storage.from.mock.results[0]?.value.upload as ReturnType<
      typeof vi.fn
    >;
    const uploadedPath = storageUploadMock.mock.calls[0]?.[0] as string;
    expect(uploadedPath).toMatch(/^events\/event-1\/hero-\d+-hero\.png$/);
    // The themes upsert carries hero_image_url — NOT logo_url
    // (which migration 0084 moved to events.logo_url).
    expect(themesInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        hero_image_url: 'https://cdn.test/events/event-1/hero.png',
      }),
    );
  });

  it('uploadHero rejects non-image mimetypes', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(
      service.uploadHero('event-1', 'user-1', {
        buffer: Buffer.from('hello'),
        filename: 'hero.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uploadHero rejects payloads exceeding the 10 MB size limit', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockResolvedValue(undefined);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

    await expect(
      service.uploadHero('event-1', 'user-1', {
        buffer: oversized,
        filename: 'huge.jpg',
        mimetype: 'image/jpeg',
      }),
    ).rejects.toThrow(/10 MB size limit/i);
  });

  it('uploadHero requires org admin role', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockRejectedValue(new ForbiddenException('Requires admin role or higher'));

    await expect(
      service.uploadHero('event-1', 'user-1', {
        buffer: Buffer.from([0x89]),
        filename: 'hero.png',
        mimetype: 'image/png',
      }),
    ).rejects.toThrow(ForbiddenException);
    // Role check fires BEFORE the bucket / size / MIME guards so a
    // non-admin caller never has their file inspected.
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
  });

  // ── Public listEvents — drives /api/v1/events used by the public site root.
  // Locks the SELECT shape + status filter that the public landing page
  // depends on. The "unavailable" banner at app.myclash.fr/ only renders
  // when this endpoint fails — keeping the contract here pinned guards
  // against silent regressions.
  describe('listPublicParticipants', () => {
    function eventSlugChain() {
      const chain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      chain.maybeSingle.mockResolvedValue({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      return chain;
    }

    it('groups a person into one row with both tournaments they are registered in', async () => {
      const tournaments = [
        { id: 't1', slug: 'longsword', name: 'Longsword Open', color: 'red' },
        { id: 't2', slug: 'rapier', name: 'Rapier Cup', color: 'blue' },
      ];
      const registrations = [
        { tournament_id: 't1', person_id: 'p1', status: 'registered' },
        { tournament_id: 't2', person_id: 'p1', status: 'checked_in' },
      ];
      const persons = [{ id: 'p1', given_name: 'Alice', family_name: 'Dupont', club_id: 'c1' }];
      const clubs = [{ id: 'c1', name: 'Lyon AMHE', abbreviation: 'LAMHE' }];

      fromMock
        .mockReturnValueOnce(eventSlugChain())
        .mockReturnValueOnce(makeAwaitableChain({ data: tournaments, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: registrations, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: clubs, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })); // event_instructors

      const result = await service.listPublicParticipants('fal-2027');

      expect(result).toHaveLength(1);
      expect(result[0]?.displayName).toBe('Alice Dupont');
      expect(result[0]?.clubName).toBe('Lyon AMHE');
      expect(result[0]?.clubAbbrev).toBe('LAMHE');
      expect(result[0]?.tournaments.map((t) => t.slug).sort()).toEqual(['longsword', 'rapier']);
    });

    it('excludes withdrawn and disqualified registrations', async () => {
      const tournaments = [{ id: 't1', slug: 'longsword', name: 'Longsword', color: 'red' }];
      // Two registrations: one withdrawn, one checked_in. Only the checked_in row
      // should make it through.
      const registrations = [
        { tournament_id: 't1', person_id: 'p1', status: 'withdrawn' },
        { tournament_id: 't1', person_id: 'p2', status: 'checked_in' },
      ];
      const persons = [{ id: 'p2', given_name: 'Bob', family_name: 'Martin', club_id: null }];

      // The status filter is applied at the DB layer (`.in('status', [...])`).
      // The mock just returns whatever rows we provide — so we provide only
      // the checked_in row, simulating the DB filter. The test asserts the
      // service uses the active-only set in the .in() call.
      const regChain = makeAwaitableChain({
        data: [{ tournament_id: 't1', person_id: 'p2', status: 'checked_in' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(eventSlugChain())
        .mockReturnValueOnce(makeAwaitableChain({ data: tournaments, error: null }))
        .mockReturnValueOnce(regChain)
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })); // event_instructors

      const result = await service.listPublicParticipants('fal-2027');

      expect(result.map((r) => r.personId)).toEqual(['p2']);
      // Withdrawn / disqualified must never be in the status filter list.
      // Active + waitlist are both surfaced; the projection separates
      // them via registrationState.
      expect(regChain.in).toHaveBeenCalledWith('status', ['registered', 'checked_in', 'waitlist']);
      // Defensive: registrations contained a withdrawn row from the start —
      // the test's `registrations` variable is unused so the .in filter is
      // the only barrier. Reference it to keep eslint happy.
      expect(registrations.length).toBeGreaterThan(0);
    });

    it('returns the row with null club fields when the person has no club_id', async () => {
      const tournaments = [{ id: 't1', slug: 'longsword', name: 'Longsword', color: 'red' }];
      const registrations = [{ tournament_id: 't1', person_id: 'p1', status: 'registered' }];
      const persons = [{ id: 'p1', given_name: 'Carol', family_name: 'Lemaire', club_id: null }];

      fromMock
        .mockReturnValueOnce(eventSlugChain())
        .mockReturnValueOnce(makeAwaitableChain({ data: tournaments, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: registrations, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })); // event_instructors

      const result = await service.listPublicParticipants('fal-2027');

      expect(result).toHaveLength(1);
      expect(result[0]?.clubName).toBeNull();
      expect(result[0]?.clubAbbrev).toBeNull();
    });

    it('marks every projected tournament with registrationState=active', async () => {
      const tournaments = [{ id: 't1', slug: 'longsword', name: 'Longsword', color: 'red' }];
      const registrations = [{ tournament_id: 't1', person_id: 'p1', status: 'registered' }];
      const persons = [{ id: 'p1', given_name: 'Dora', family_name: 'Costa', club_id: null }];

      fromMock
        .mockReturnValueOnce(eventSlugChain())
        .mockReturnValueOnce(makeAwaitableChain({ data: tournaments, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: registrations, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })); // event_instructors

      const result = await service.listPublicParticipants('fal-2027');
      expect(result[0]?.tournaments[0]?.registrationState).toBe('active');
    });

    it('with includeStaff appends non-competing referees/instructors', async () => {
      const tournaments = [{ id: 't1', slug: 'longsword', name: 'Longsword', color: 'red' }];
      const registrations = [{ tournament_id: 't1', person_id: 'p1', status: 'registered' }];
      // Alice competes AND referees (global g1). Bob (g2) referees but does not
      // compete yet has an event persons row (p2). Carol (g3) instructs with no
      // persons row → resolved from global_persons, personId stays null.
      const persons = [
        { id: 'p1', given_name: 'Alice', family_name: 'A', club_id: null, global_person_id: 'g1' },
      ];

      fromMock
        .mockReturnValueOnce(eventSlugChain())
        .mockReturnValueOnce(makeAwaitableChain({ data: tournaments, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: registrations, error: null }))
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }))
        .mockReturnValueOnce(
          makeAwaitableChain({ data: [{ person_id: 'g1' }, { person_id: 'g2' }], error: null }),
        ) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [{ person_id: 'g3' }], error: null })) // event_instructors
        .mockReturnValueOnce(
          makeAwaitableChain({
            data: [
              {
                id: 'p2',
                given_name: 'Bob',
                family_name: 'B',
                club_id: 'c1',
                global_person_id: 'g2',
              },
            ],
            error: null,
          }),
        ) // staff persons (pass 1)
        .mockReturnValueOnce(
          makeAwaitableChain({
            data: [
              {
                id: 'g3',
                given_name: 'Carol',
                family_name: 'C',
                display_name: 'Carol C',
                club_id: null,
              },
            ],
            error: null,
          }),
        ) // global_persons fallback (pass 2)
        .mockReturnValueOnce(
          makeAwaitableChain({
            data: [{ id: 'c1', name: 'Paris HEMA', abbreviation: 'PAR' }],
            error: null,
          }),
        ); // staff clubs

      const result = await service.listPublicParticipants('fal-2027', { includeStaff: true });

      const alice = result.find((r) => r.globalPersonId === 'g1');
      expect(alice?.isReferee).toBe(true);
      expect(alice?.tournaments).toHaveLength(1);

      const bob = result.find((r) => r.globalPersonId === 'g2');
      expect(bob).toBeDefined();
      expect(bob?.personId).toBe('p2');
      expect(bob?.displayName).toBe('Bob B');
      expect(bob?.clubName).toBe('Paris HEMA');
      expect(bob?.clubAbbrev).toBe('PAR');
      expect(bob?.isReferee).toBe(true);
      expect(bob?.isInstructor).toBe(false);
      expect(bob?.tournaments).toEqual([]);

      const carol = result.find((r) => r.globalPersonId === 'g3');
      expect(carol).toBeDefined();
      expect(carol?.personId).toBeNull();
      expect(carol?.displayName).toBe('Carol C');
      expect(carol?.isInstructor).toBe(true);
      expect(carol?.isReferee).toBe(false);
      expect(carol?.tournaments).toEqual([]);
    });
  });

  describe('listEvents (public)', () => {
    it('returns events enriched with tournament_count + org logo_url', async () => {
      const rows = [
        {
          id: 'event-pub',
          name: 'Lyon Spring',
          status: 'published',
          start_date: '2026-06-01',
          end_date: '2026-06-02',
          organizations: {
            name: 'Lyon AMHE',
            slug: 'lyon-amhe',
            logo_url: 'https://cdn/lyon.png',
            brand_color: '#b91c1c',
          },
        },
        {
          id: 'event-pub-2',
          name: 'Paris Open',
          status: 'completed',
          start_date: '2025-12-01',
          end_date: '2025-12-02',
          organizations: {
            name: 'Paris HEMA',
            slug: 'paris-hema',
            logo_url: null,
            brand_color: null,
          },
        },
      ];
      const tournaments = [
        { id: 't-1', event_id: 'event-pub' },
        { id: 't-2', event_id: 'event-pub' },
        { id: 't-3', event_id: 'event-pub' },
        { id: 't-4', event_id: 'event-pub-2' },
      ];
      // Two tournaments on event-pub join the same league → dedupes to
      // one. event-pub also joins a second distinct league via t-3.
      // event-pub-2 has no league links → empty leagues array.
      const linkRows = [
        { tournament_id: 't-1', leagues: { id: 'L1', name: 'French Cup', slug: 'french-cup' } },
        { tournament_id: 't-2', leagues: { id: 'L1', name: 'French Cup', slug: 'french-cup' } },
        { tournament_id: 't-3', leagues: { id: 'L2', name: 'Regional', slug: 'regional' } },
      ];
      const eventsChain = makeAwaitableChain({ data: rows, error: null });
      const tournamentsChain = makeAwaitableChain({ data: tournaments, error: null });
      const linksChain = makeAwaitableChain({ data: linkRows, error: null });
      fromMock
        .mockReturnValueOnce(eventsChain)
        .mockReturnValueOnce(tournamentsChain)
        .mockReturnValueOnce(linksChain);

      const result = (await service.listEvents({})) as Array<{
        id: string;
        tournament_count: number;
        leagues: Array<{ id: string; name: string; slug: string }>;
      }>;

      // Public landing page relies on the joined organization
      // name/slug/logo_url/brand_color; dropping any of these breaks the card
      // subtitle / logo / per-card accent stripe on app.myclash.fr/.
      expect(eventsChain.select).toHaveBeenCalledWith(
        '*, organizations(name, slug, logo_url, brand_color)',
      );
      // Default status filter when no `status` arg is given.
      expect(eventsChain.in).toHaveBeenCalledWith('status', ['published', 'running', 'completed']);
      // Newest events first so the freshly-published event lands at the
      // top of the public list immediately after the admin publish.
      expect(eventsChain.order).toHaveBeenCalledWith('start_date', { ascending: false });
      // tournament_count is folded onto each row from the batched lookup.
      expect(result.find((r) => r.id === 'event-pub')?.tournament_count).toBe(3);
      expect(result.find((r) => r.id === 'event-pub-2')?.tournament_count).toBe(1);
      // Linked-league list is folded on too. event-pub has two
      // tournaments joining the same league (deduped) + a third
      // joining a second league → 2 distinct leagues. event-pub-2
      // has no league links → empty array. The public Upcoming
      // table reads this directly to render the League column.
      const pub = result.find((r) => r.id === 'event-pub');
      expect(pub?.leagues.map((l) => l.id).sort()).toEqual(['L1', 'L2']);
      expect(result.find((r) => r.id === 'event-pub-2')?.leagues).toEqual([]);
    });

    it('leaves the select string untouched when no weapon filter is applied', async () => {
      // Locks the hot path: adding the !inner embed unconditionally would make
      // every public list request pay for a join it does not need.
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await service.listEvents({ country: 'FR', from: '2026-01-01' });

      expect(chain.select).toHaveBeenCalledWith(
        '*, organizations(name, slug, logo_url, brand_color)',
      );
    });

    it('filters by weapon through an inner tournaments embed and strips it from the payload', async () => {
      const weaponChain = makeAwaitableChain({ data: { name: 'Longsword' }, error: null });
      const eventsChain = makeAwaitableChain({
        data: [
          {
            id: 'event-ls',
            name: 'Lyon Spring',
            // The embed the !inner filter injects — a filter mechanism, not
            // part of the public contract.
            tournaments: [{ weapon: 'Longsword' }],
          },
        ],
        error: null,
      });
      const tournamentsChain = makeAwaitableChain({ data: [], error: null });
      fromMock
        .mockReturnValueOnce(weaponChain)
        .mockReturnValueOnce(eventsChain)
        .mockReturnValueOnce(tournamentsChain);

      const result = (await service.listEvents({ weapon: 'longsword' })) as Array<
        Record<string, unknown>
      >;

      expect(eventsChain.select).toHaveBeenCalledWith(
        '*, organizations(name, slug, logo_url, brand_color), tournaments!inner(weapon)',
      );
      // Exact eq on the canonical catalog NAME — tournaments.weapon is
      // canonicalised on write, so this is both correct and indexable.
      expect(eventsChain.eq).toHaveBeenCalledWith('tournaments.weapon', 'Longsword');
      expect(result[0]).not.toHaveProperty('tournaments');
    });

    it('returns an empty list for an unknown weapon slug without querying events', async () => {
      // These are bookmarked, shared URLs. A retired weapon should read as
      // "no results", not an error page.
      const weaponChain = makeAwaitableChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(weaponChain);

      const result = await service.listEvents({ weapon: 'no-such-weapon' });

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('folds a matching organiser into the free-text OR as a bounded id list', async () => {
      const orgChain = makeAwaitableChain({
        data: [{ id: 'org-1' }, { id: 'org-2' }],
        error: null,
      });
      const eventsChain = makeAwaitableChain({ data: [], error: null });
      // events is queried first (the builder is constructed before the
      // free-text clauses resolve), then organizations.
      fromMock.mockReturnValueOnce(eventsChain).mockReturnValueOnce(orgChain);

      await service.listEvents({ q: 'lyon' });

      // The org term cannot ride in the same .or() as the event columns —
      // PostgREST has no cross-table OR — so it arrives pre-resolved.
      expect(orgChain.limit).toHaveBeenCalledWith(50);
      const orArg = eventsChain.or.mock.calls[0]?.[0] as string;
      expect(orArg).toContain('name.ilike.%lyon%');
      expect(orArg).toContain('city.ilike.%lyon%');
      expect(orArg).toContain('organization_id.in.(org-1,org-2)');
    });

    it('omits the organisation clause when no organiser matches', async () => {
      const orgChain = makeAwaitableChain({ data: [], error: null });
      const eventsChain = makeAwaitableChain({ data: [], error: null });
      // events is queried first (the builder is constructed before the
      // free-text clauses resolve), then organizations.
      fromMock.mockReturnValueOnce(eventsChain).mockReturnValueOnce(orgChain);

      await service.listEvents({ q: 'zzzz' });

      expect(eventsChain.or.mock.calls[0]?.[0]).not.toContain('organization_id.in.');
    });

    it('strips PostgREST metacharacters out of the free-text term', async () => {
      // A `,` or `)` would close the in.() list early and inject a sibling
      // filter, broadening the WHERE clause past what the query intended.
      const orgChain = makeAwaitableChain({ data: [{ id: 'org-1' }], error: null });
      const eventsChain = makeAwaitableChain({ data: [], error: null });
      // events is queried first (the builder is constructed before the
      // free-text clauses resolve), then organizations.
      fromMock.mockReturnValueOnce(eventsChain).mockReturnValueOnce(orgChain);

      await service.listEvents({ q: 'ly,on)(*' });

      const orArg = eventsChain.or.mock.calls[0]?.[0] as string;
      expect(orArg).toContain('name.ilike.%lyon%');
      expect(orArg).not.toMatch(/lyon[,)(*]/);
      // The only parens/commas left are the ones this method wrote itself.
      expect(orArg).toBe(
        'name.ilike.%lyon%,city.ilike.%lyon%,country.ilike.%lyon%,organization_id.in.(org-1)',
      );
    });

    it('applies the date window as an overlap, not a containment', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await service.listEvents({ from: '2026-06-01', to: '2026-06-30' });

      // An event ending on/after `from` and starting before the day AFTER `to`
      // overlaps the window — so a 3-day event surfaces for any day inside it.
      expect(chain.gte).toHaveBeenCalledWith('end_date', '2026-06-01');
      expect(chain.lt).toHaveBeenCalledWith('start_date', '2026-07-01');
    });

    it('filters by country code', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await service.listEvents({ country: 'fr' });

      // ilike, not eq: the column is free text at the DB level even though the
      // write DTOs enforce a 2-char code, so casing is not guaranteed.
      expect(chain.ilike).toHaveBeenCalledWith('country', 'fr');
    });

    it('honours an explicit status filter when the caller passes one', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await service.listEvents({ status: 'completed' });

      expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
      // The default `in('status', [...])` must NOT be applied when the
      // caller narrowed the filter explicitly.
      expect(chain.in).not.toHaveBeenCalled();
    });

    it('translates a supabase error into BadRequestException', async () => {
      // The public landing page treats any non-2xx as "unavailable" and
      // shows a banner with no diagnostic. The error path here is what
      // produces that 400 → ensures we don't accidentally start
      // returning `[]` on supabase errors (which would mask the failure
      // as "empty events").
      const chain = makeAwaitableChain({
        data: null,
        error: { message: 'boom' },
      });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.listEvents({})).rejects.toThrow(BadRequestException);
    });

    it('caps the row count at 100 by default — spectators poll this endpoint every ~30 s', async () => {
      // Default applies when no `limit` is passed. Clamping at 100 keeps
      // per-poll payload bounded regardless of deploy size.
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);
      await service.listEvents({});
      expect(chain.limit).toHaveBeenCalledWith(100);
    });

    it('honours an explicit limit and clamps it back to 100 if larger', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);
      await service.listEvents({ limit: 999 });
      expect(chain.limit).toHaveBeenCalledWith(100);
    });

    it('paginates by cursor — applies start_date < cursor when set', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);
      await service.listEvents({ cursor: '2026-01-01T00:00:00.000Z' });
      expect(chain.lt).toHaveBeenCalledWith('start_date', '2026-01-01T00:00:00.000Z');
    });
  });

  describe('listTournaments', () => {
    it('decorates each tournament with registered = count of registered + checked_in', async () => {
      // Drives the new "Registered" column on the admin tournament
      // list. Mirrors the capacity-guard semantics in
      // registrations.service.assertCapacity — 'withdrawn' /
      // 'disqualified' / 'waitlist' don't count toward the cap.
      const tournamentsChain = makeChain({
        data: [
          { id: 't-1', name: 'Longsword', max_participants: 12, max_waitlist: 5 },
          { id: 't-2', name: 'Sabre', max_participants: null, max_waitlist: null },
        ],
        error: null,
      });
      tournamentsChain.order.mockResolvedValue({
        data: [
          { id: 't-1', name: 'Longsword', max_participants: 12, max_waitlist: 5 },
          { id: 't-2', name: 'Sabre', max_participants: null, max_waitlist: null },
        ],
        error: null,
      });

      const registrationsChain = makeAwaitableChain({
        data: [
          { tournament_id: 't-1', status: 'registered' },
          { tournament_id: 't-1', status: 'registered' },
          { tournament_id: 't-1', status: 'checked_in' },
          // withdrawn doesn't count
        ],
        error: null,
      });
      // Waitlist + phases + pools + matches stubs (added when
      // listTournaments started decorating rows with aggregate counts
      // for the public event home page). Empty results — this test
      // focuses on the registered count, not the new fields.
      const waitlistChain = makeAwaitableChain({ data: [], error: null });
      const phasesChain = makeAwaitableChain({ data: [], error: null });

      const phaseVenuesChain = makeAwaitableChain({ data: [], error: null });
      const regCallQueue = [registrationsChain, waitlistChain];
      fromMock.mockImplementation((table: string) => {
        if (table === 'tournaments') return tournamentsChain;
        if (table === 'registrations') return regCallQueue.shift() ?? waitlistChain;
        if (table === 'phases') return phasesChain;
        if (table === 'tournament_phase_venues') return phaseVenuesChain;
        throw new Error(`unexpected table ${table}`);
      });

      const result = (await service.listTournaments('event-1')) as unknown as Array<{
        id: string;
        registered: number;
        max_participants: number | null;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('t-1');
      expect(result[0]!.registered).toBe(3);
      expect(result[0]!.max_participants).toBe(12);
      expect(result[1]!.id).toBe('t-2');
      expect(result[1]!.registered).toBe(0);
      expect(result[1]!.max_participants).toBeNull();
    });

    it('returns [] without fanning out the registrations fetch when the event has no tournaments', async () => {
      const tournamentsChain = makeChain({ data: [], error: null });
      tournamentsChain.order.mockResolvedValue({ data: [], error: null });
      fromMock.mockReturnValueOnce(tournamentsChain);

      const result = await service.listTournaments('event-1');

      expect(result).toEqual([]);
      // registrations table must not be queried
      expect(fromMock).toHaveBeenCalledTimes(1);
      expect(fromMock).toHaveBeenCalledWith('tournaments');
    });
  });

  // ── Public tournament standings — pins post-0063 & visibility refactor ─────

  describe('getPublicTournamentStandings', () => {
    it('returns empty pools + bracket for a draft tournament, skipping the phases fetch', async () => {
      const eventChain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      const tournamentChain = makeChain({
        data: {
          id: 'tournament-1',
          name: 'Longsword Open',
          weapon: 'longsword',
          ruleset_code: 'TF_v1',
          status: 'draft',
          logo_url: null,
        },
        error: null,
      });
      fromMock.mockImplementation(dispatchWithRulesetResolution([eventChain, tournamentChain]));

      const result = await service.getPublicTournamentStandings('fal-2027', 'longsword-open');

      expect(result).toMatchObject({
        tournament: { name: 'Longsword Open', status: 'draft' },
        pools: [],
        bracketSlots: [],
        bracketSize: 0,
        bracketRounds: 0,
      });
      // Phases (and everything downstream) must not be queried when the
      // tournament itself isn't public — tournament status is the gate.
      expect(fromMock).not.toHaveBeenCalledWith('phases');
      expect(fromMock).not.toHaveBeenCalledWith('pools');
      expect(fromMock).not.toHaveBeenCalledWith('referee_assignments');
    });

    it('fetches phases without filtering on visibility_status when the tournament is published', async () => {
      const eventChain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      const tournamentChain = makeChain({
        data: {
          id: 'tournament-1',
          name: 'Longsword Open',
          weapon: 'longsword',
          ruleset_code: 'TF_v1',
          status: 'published',
          logo_url: null,
        },
        error: null,
      });
      // Phases: a single pool phase whose visibility_status is 'hidden'.
      // Pre-refactor this would have been filtered out by `.eq('visibility_status', 'published')`
      // and the standings would have come back empty. Post-refactor the
      // tournament's status alone gates the public read, so the pool phase
      // surfaces regardless.
      const phasesChain = makeAwaitableChain({
        data: [
          {
            id: 'phase-pool-1',
            type: 'pool',
            visibility_status: 'hidden',
            config_json: {},
          },
        ],
        error: null,
      });
      // Pools fetch — empty so we don't have to mock the deep registration
      // embed; what matters here is the filter contract.
      const poolsChain = makeAwaitableChain({ data: [], error: null });
      // Aggregate-count chains (participantCount + waitlistCount +
      // completedMatchCount) added when getPublicTournamentStandings
      // started surfacing per-tournament stats on the response header.
      const participantCountChain = makeAwaitableChain({ count: 0, error: null });
      const waitlistCountChain = makeAwaitableChain({ count: 0, error: null });
      const completedMatchCountChain = makeAwaitableChain({ count: 0, error: null });
      // Referees fetch fires only when there are pools — pools is empty so
      // referee_assignments shouldn't be queried at all in this test. We
      // assert that below.
      fromMock.mockImplementation(
        dispatchWithRulesetResolution([
          eventChain,
          tournamentChain,
          phasesChain,
          participantCountChain,
          waitlistCountChain,
          completedMatchCountChain,
          poolsChain,
        ]),
      );

      const result = await service.getPublicTournamentStandings('fal-2027', 'longsword-open');

      // The phases query must NOT filter on visibility_status. Earlier
      // bug: `.eq('visibility_status', 'published')` kept hidden phases
      // off the public page even when the tournament was published.
      const visibilityFilterCall = phasesChain.eq.mock.calls.find(
        (c) => c[0] === 'visibility_status',
      );
      expect(visibilityFilterCall).toBeUndefined();
      expect(phasesChain.eq).toHaveBeenCalledWith('tournament_id', 'tournament-1');

      // Tournament header carries through, and the response shape is the
      // canonical empty-pools shape (not a 404 / not null).
      expect(result.tournament.name).toBe('Longsword Open');
      expect(result.pools).toEqual([]);

      // poolIds === [] short-circuits the referee query — pins the
      // public path against a regression that re-introduces the
      // stale `user_id` column in the select.
      expect(fromMock).not.toHaveBeenCalledWith('referee_assignments');
    });

    it('does not request referee_assignments.user_id (dropped by migration 0063)', async () => {
      const eventChain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      const tournamentChain = makeChain({
        data: {
          id: 'tournament-1',
          name: 'Longsword Open',
          weapon: 'longsword',
          ruleset_code: 'TF_v1',
          status: 'published',
          logo_url: null,
        },
        error: null,
      });
      const phasesChain = makeAwaitableChain({
        data: [
          { id: 'phase-pool-1', type: 'pool', visibility_status: 'published', config_json: {} },
        ],
        error: null,
      });
      // One pool with no members — keeps the test focused on the
      // referee_assignments select shape.
      const poolsChain = makeAwaitableChain({
        data: [{ id: 'pool-1', name: 'Pool A', pool_members: [] }],
        error: null,
      });
      const refereesChain = makeAwaitableChain({ data: [], error: null });
      // getPublishedPools now also reads the pools' matches (pool_id,
      // scheduled_at, lices) to derive each pool's lice + start time. Empty
      // here — this test only pins the referee_assignments select shape.
      const poolMatchesChain = makeAwaitableChain({ data: [], error: null });
      // Aggregate-count chains added when getPublicTournamentStandings
      // started surfacing per-tournament stats on the response header.
      const participantCountChain = makeAwaitableChain({ count: 0, error: null });
      const waitlistCountChain = makeAwaitableChain({ count: 0, error: null });
      const completedMatchCountChain = makeAwaitableChain({ count: 0, error: null });

      fromMock.mockImplementation(
        dispatchWithRulesetResolution([
          eventChain,
          tournamentChain,
          phasesChain,
          participantCountChain,
          waitlistCountChain,
          completedMatchCountChain,
          poolsChain,
          refereesChain,
          poolMatchesChain,
        ]),
      );

      await service.getPublicTournamentStandings('fal-2027', 'longsword-open');

      // The select string fed to the referee_assignments query MUST NOT
      // include `user_id` — that column was dropped by migration 0063.
      // Asking for it returns 400 from PostgREST and bricks the page.
      const selectCalls = refereesChain.select.mock.calls;
      expect(selectCalls.length).toBeGreaterThan(0);
      for (const call of selectCalls) {
        expect(String(call[0])).not.toMatch(/\buser_id\b/);
      }
      // Sanity: person_id is the canonical key post-0063.
      expect(String(selectCalls[0]![0])).toMatch(/\bperson_id\b/);
    });

    it('attaches match-scoped referees to bracket slots (and [] when none)', async () => {
      const eventChain = makeChain({ data: { id: 'event-1', slug: 'fal-2027' }, error: null });
      const tournamentChain = makeChain({
        data: {
          id: 'tournament-1',
          name: 'Longsword Open',
          weapon: 'longsword',
          ruleset_code: 'TF_v1',
          status: 'published',
          logo_url: null,
          color: null,
        },
        error: null,
      });
      // Bracket phase only (no pool phase) — exercises the getPublishedBracket path.
      const phasesChain = makeAwaitableChain({
        data: [
          {
            id: 'phase-br-1',
            type: 'single_elim',
            visibility_status: 'published',
            config_json: { bracketSize: 4, rounds: 2 },
          },
        ],
        error: null,
      });
      const participantCountChain = makeAwaitableChain({ count: 0, error: null });
      const waitlistCountChain = makeAwaitableChain({ count: 0, error: null });
      const completedMatchCountChain = makeAwaitableChain({ count: 0, error: null });
      // slot-1 → match-1 (has a referee); slot-2 → match-2 (no referee); slot-3 → no match.
      const bracketSlotsChain = makeAwaitableChain({
        data: [
          {
            id: 'slot-1',
            round: 2,
            position: 1,
            registration_a_id: 'reg-a',
            registration_b_id: 'reg-b',
          },
          { id: 'slot-2', round: 1, position: 1, registration_a_id: null, registration_b_id: null },
          { id: 'slot-3', round: 1, position: 2, registration_a_id: null, registration_b_id: null },
        ],
        error: null,
      });
      const bracketMatchesChain = makeAwaitableChain({
        data: [
          {
            id: 'match-1',
            bracket_slot_id: 'slot-1',
            status: 'completed',
            red_score: 5,
            blue_score: 3,
            match_number_label: 'F1',
          },
          {
            id: 'match-2',
            bracket_slot_id: 'slot-2',
            status: 'scheduled',
            red_score: null,
            blue_score: null,
            match_number_label: 'M1',
          },
        ],
        error: null,
      });
      const bracketRegsChain = makeAwaitableChain({
        data: [
          {
            id: 'reg-a',
            persons: {
              given_name: 'Alice',
              family_name: 'A',
              clubs: { name: 'Club A', abbreviation: 'CA' },
            },
          },
          {
            id: 'reg-b',
            persons: {
              given_name: 'Bob',
              family_name: 'B',
              clubs: { name: 'Club B', abbreviation: 'CB' },
            },
          },
        ],
        error: null,
      });
      // Only match-1 has an assignment.
      const refereeAssignmentsChain = makeAwaitableChain({
        data: [
          {
            match_id: 'match-1',
            role: 'arbitre_declarant',
            status: 'confirmed',
            person_id: 'person-1',
          },
        ],
        error: null,
      });
      const globalPersonsChain = makeAwaitableChain({
        data: [{ id: 'person-1', given_name: 'Rita', family_name: 'Ref' }],
        error: null,
      });
      const refereeSkillsChain = makeAwaitableChain({
        data: [{ id: 'arbitre_declarant', color: 'red' }],
        error: null,
      });

      fromMock.mockImplementation(
        dispatchWithRulesetResolution([
          eventChain,
          tournamentChain,
          phasesChain,
          participantCountChain,
          waitlistCountChain,
          completedMatchCountChain,
          bracketSlotsChain,
          bracketMatchesChain,
          bracketRegsChain,
          refereeAssignmentsChain,
          globalPersonsChain,
          refereeSkillsChain,
        ]),
      );

      const result = await service.getPublicTournamentStandings('fal-2027', 'longsword-open');

      const slots = result.bracketSlots as Array<{ id: string; referees: unknown[] }>;
      const s1 = slots.find((s) => s.id === 'slot-1');
      const s2 = slots.find((s) => s.id === 'slot-2');
      const s3 = slots.find((s) => s.id === 'slot-3');
      expect(s1?.referees).toEqual([
        {
          role: 'arbitre_declarant',
          displayName: 'Rita Ref',
          status: 'confirmed',
          skillColor: 'red',
        },
      ]);
      // Match with no assignment → empty; slot with no match → empty.
      expect(s2?.referees).toEqual([]);
      expect(s3?.referees).toEqual([]);
      expect(result.bracketSize).toBe(4);
      expect(result.bracketRounds).toBe(2);

      // The match-scoped referee query must filter scope_type='match', request
      // person_id, and (post-0063) never request the dropped user_id column.
      const selectCalls = refereeAssignmentsChain.select.mock.calls;
      expect(selectCalls.length).toBeGreaterThan(0);
      expect(String(selectCalls[0]![0])).toMatch(/\bmatch_id\b/);
      expect(String(selectCalls[0]![0])).toMatch(/\bperson_id\b/);
      expect(String(selectCalls[0]![0])).not.toMatch(/\buser_id\b/);
      expect(refereeAssignmentsChain.eq).toHaveBeenCalledWith('scope_type', 'match');
    });
  });

  describe('publishTournament', () => {
    it('cascades visibility=published to every child phase', async () => {
      // setTournamentStatus does, in order:
      //   1. tournaments.select(event_id).eq(id).maybeSingle()
      //   2. events.select(...).eq(id).maybeSingle()  (via getEventById)
      //   3. authz: assertOrgRole
      //   4. tournaments.update(...).eq(id).select('*').single()
      //   5. NEW — phases.update({visibility_status:'published', ...})
      //                  .eq('tournament_id', tournamentId)
      const tournamentLookup = makeChain({
        data: { event_id: 'event-1' },
        error: null,
      });
      const eventLookup = makeChain({
        data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
        error: null,
      });
      const tournamentUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: 'tourn-1', status: 'published' }, error: null }),
      };
      const phasesUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      fromMock
        .mockReturnValueOnce(tournamentLookup)
        .mockReturnValueOnce(eventLookup)
        .mockReturnValueOnce(tournamentUpdate)
        .mockReturnValueOnce(phasesUpdate);
      assertOrgRole.mockResolvedValue(undefined);

      await service.publishTournament('tourn-1', 'user-1');

      // Tournament status moves to 'published'.
      expect(tournamentUpdate.update).toHaveBeenCalledTimes(1);
      expect(tournamentUpdate.update.mock.calls[0]![0]).toMatchObject({ status: 'published' });

      // Phases cascade: visibility_status='published' on every row
      // belonging to the tournament, with audit stamps.
      expect(phasesUpdate.update).toHaveBeenCalledTimes(1);
      const phasesPayload = phasesUpdate.update.mock.calls[0]![0] as Record<string, unknown>;
      expect(phasesPayload['visibility_status']).toBe('published');
      expect(phasesPayload['published_at']).toEqual(expect.any(String));
      expect(phasesPayload['published_by_user_id']).toBe('user-1');

      // Cascade filter: every phase WHERE tournament_id = 'tourn-1'.
      expect(phasesUpdate.eq).toHaveBeenCalledWith('tournament_id', 'tourn-1');
    });

    it('hides all child phases when the tournament moves back to draft', async () => {
      // Reverse cascade — operator un-publishes the tournament, the
      // phase rows must follow so RLS on the pools table stops
      // serving anonymous reads.
      const tournamentLookup = makeChain({
        data: { event_id: 'event-1' },
        error: null,
      });
      const eventLookup = makeChain({
        data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
        error: null,
      });
      const tournamentUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: 'tourn-1', status: 'draft' }, error: null }),
      };
      const phasesUpdate = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      fromMock
        .mockReturnValueOnce(tournamentLookup)
        .mockReturnValueOnce(eventLookup)
        .mockReturnValueOnce(tournamentUpdate)
        .mockReturnValueOnce(phasesUpdate);
      assertOrgRole.mockResolvedValue(undefined);

      await service.unpublishTournament('tourn-1', 'user-1');

      // Tournament status moves to 'draft'.
      expect(tournamentUpdate.update.mock.calls[0]![0]).toMatchObject({ status: 'draft' });

      // Phases cascade: visibility_status='hidden'. published_at and
      // published_by_user_id are NOT touched on the hide direction —
      // they stay as the historical record of the previous publish.
      expect(phasesUpdate.update).toHaveBeenCalledTimes(1);
      const phasesPayload = phasesUpdate.update.mock.calls[0]![0] as Record<string, unknown>;
      expect(phasesPayload['visibility_status']).toBe('hidden');
      expect(phasesPayload).not.toHaveProperty('published_at');
      expect(phasesPayload).not.toHaveProperty('published_by_user_id');
      expect(phasesUpdate.eq).toHaveBeenCalledWith('tournament_id', 'tourn-1');
    });
  });

  describe('listTournaments aggregates', () => {
    it('returns waitlistCount + poolCount + bracketSize + pool/bracket fight counts + refereeCount per tournament', async () => {
      const tournamentsChain = makeChain({ data: null, error: null });
      tournamentsChain.order.mockResolvedValue({
        data: [{ id: 't-1', name: 'Longsword', max_participants: 12 }],
        error: null,
      });
      // Existing: registered count via grouped registrations fetch
      // (status IN registered/checked_in).
      const registeredChain = makeAwaitableChain({
        data: [
          { tournament_id: 't-1', status: 'registered' },
          { tournament_id: 't-1', status: 'checked_in' },
        ],
        error: null,
      });
      // NEW: grouped waitlist count.
      const waitlistChain = makeAwaitableChain({
        data: [{ tournament_id: 't-1' }, { tournament_id: 't-1' }, { tournament_id: 't-1' }],
        error: null,
      });
      // NEW: phases per tournament (id, type, tournament_id, config_json
      // for bracket size + pool flagging).
      const phasesChain = makeAwaitableChain({
        data: [
          {
            id: 'phase-pool-1',
            tournament_id: 't-1',
            type: 'pool',
            config_json: {},
          },
          {
            id: 'phase-bracket-1',
            tournament_id: 't-1',
            type: 'single_elim',
            config_json: { bracketSize: 16 },
          },
        ],
        error: null,
      });
      // Matches across all phases, bucketed pool vs bracket by phase type:
      // pool → 2 completed / 3 total; bracket → 1 completed / 2 total.
      const matchesChain = makeAwaitableChain({
        data: [
          { phase_id: 'phase-pool-1', status: 'completed' },
          { phase_id: 'phase-pool-1', status: 'completed' },
          { phase_id: 'phase-pool-1', status: 'scheduled' },
          { phase_id: 'phase-bracket-1', status: 'completed' },
          { phase_id: 'phase-bracket-1', status: 'running' },
        ],
        error: null,
      });
      // Pools per phase (poolCount + pool→tournament for referee count).
      const poolsChain = makeAwaitableChain({
        data: [
          { id: 'pool-a', phase_id: 'phase-pool-1' },
          { id: 'pool-b', phase_id: 'phase-pool-1' },
          { id: 'pool-c', phase_id: 'phase-pool-1' },
          { id: 'pool-d', phase_id: 'phase-pool-1' },
        ],
        error: null,
      });
      // Referee assignments (pool-scoped) — distinct persons = {ref-1, ref-2}.
      const refereeChain = makeAwaitableChain({
        data: [
          { pool_id: 'pool-a', person_id: 'ref-1' },
          { pool_id: 'pool-a', person_id: 'ref-2' },
          { pool_id: 'pool-b', person_id: 'ref-1' },
        ],
        error: null,
      });

      // NEW: per-phase venue assignment (pools @ Hall A, bracket @ Hall B).
      const phaseVenuesChain = makeAwaitableChain({
        data: [
          { tournament_id: 't-1', phase_kind: 'pool', venues: { id: 'v-1', name: 'Hall A' } },
          { tournament_id: 't-1', phase_kind: 'bracket', venues: { id: 'v-2', name: 'Hall B' } },
        ],
        error: null,
      });

      // Registrations is queried twice: registered then waitlist. Use a
      // shift queue so the test doesn't couple to call-site indices.
      const regCalls = [registeredChain, waitlistChain];
      fromMock.mockImplementation((table: string) => {
        if (table === 'tournaments') return tournamentsChain;
        if (table === 'registrations') return regCalls.shift() ?? waitlistChain;
        if (table === 'phases') return phasesChain;
        if (table === 'matches') return matchesChain;
        if (table === 'pools') return poolsChain;
        if (table === 'referee_assignments') return refereeChain;
        if (table === 'tournament_phase_venues') return phaseVenuesChain;
        throw new Error(`unexpected table ${table}`);
      });

      const result = (await service.listTournaments('event-1')) as Array<{
        id: string;
        registered: number;
        waitlistCount: number;
        poolCount: number;
        bracketSize: number;
        poolFightsTotal: number;
        poolFightsCompleted: number;
        bracketFightsTotal: number;
        bracketFightsCompleted: number;
        refereeCount: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        phaseVenues: {
          pool: { id: string; name: string } | null;
          bracket: { id: string; name: string } | null;
        };
      }>;

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 't-1',
        registered: 2,
        waitlistCount: 3,
        poolCount: 4,
        bracketSize: 16,
        poolFightsTotal: 3,
        poolFightsCompleted: 2,
        bracketFightsTotal: 2,
        bracketFightsCompleted: 1,
        refereeCount: 2,
        phaseVenues: {
          pool: { id: 'v-1', name: 'Hall A' },
          bracket: { id: 'v-2', name: 'Hall B' },
        },
      });
    });
  });

  describe('listPublicParticipants waitlist projection', () => {
    it('marks waitlist registrations with registrationState=waitlist', async () => {
      const eventChain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      const tournamentsChain = makeAwaitableChain({
        data: [{ id: 't-1', slug: 'longsword', name: 'Longsword', color: null }],
        error: null,
      });
      // One person on the waitlist, one person registered.
      const regsChain = makeAwaitableChain({
        data: [
          {
            tournament_id: 't-1',
            person_id: 'p-1',
            status: 'registered',
            waitlist_position: null,
          },
          {
            tournament_id: 't-1',
            person_id: 'p-2',
            status: 'waitlist',
            waitlist_position: 1,
          },
        ],
        error: null,
      });
      const personsChain = makeAwaitableChain({
        data: [
          { id: 'p-1', given_name: 'Alice', family_name: 'A', club_id: null },
          { id: 'p-2', given_name: 'Bob', family_name: 'B', club_id: null },
        ],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(eventChain)
        .mockReturnValueOnce(tournamentsChain)
        .mockReturnValueOnce(regsChain)
        .mockReturnValueOnce(personsChain)
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })) // event_referees
        .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null })); // event_instructors

      const result = await service.listPublicParticipants('fal-2027');

      const bob = result.find((r) => r.personId === 'p-2');
      expect(bob).toBeDefined();
      expect(bob!.tournaments).toHaveLength(1);
      expect(bob!.tournaments[0]).toMatchObject({
        id: 't-1',
        registrationState: 'waitlist',
        waitlistPosition: 1,
      });

      const alice = result.find((r) => r.personId === 'p-1');
      expect(alice).toBeDefined();
      expect(alice!.tournaments[0]).toMatchObject({
        id: 't-1',
        registrationState: 'active',
      });
    });
  });

  describe('getPublicTournamentStandings aggregates', () => {
    // Placed last in the file because a failing assertion in this
    // suite throws before the test can drain its mockReturnValueOnce
    // queue. Subsequent tests would inherit stale mocks otherwise —
    // vi.clearAllMocks() clears call history but NOT the pending
    // implementation queue.
    it('returns participantCount on the tournament header for a published tournament', async () => {
      const eventChain = makeChain({
        data: { id: 'event-1', slug: 'fal-2027' },
        error: null,
      });
      const tournamentChain = makeChain({
        data: {
          id: 'tournament-1',
          name: 'Longsword Open',
          weapon: 'longsword',
          ruleset_code: 'TF_v1',
          status: 'published',
          logo_url: null,
        },
        error: null,
      });
      const phasesChain = makeAwaitableChain({ data: [], error: null });
      // NEW — registrations COUNT for participantCount (status IN
      // ('registered','checked_in') AND tournament_id = ?).
      const participantCountChain = makeAwaitableChain({ count: 23, error: null });
      // NEW — registrations COUNT for waitlistCount (status='waitlist').
      const waitlistCountChain = makeAwaitableChain({ count: 4, error: null });
      fromMock.mockImplementation(
        dispatchWithRulesetResolution([
          eventChain,
          tournamentChain,
          phasesChain,
          participantCountChain,
          waitlistCountChain,
        ]),
      );

      const result = await service.getPublicTournamentStandings('fal-2027', 'longsword-open');

      expect(result.tournament).toMatchObject({
        participantCount: 23,
        waitlistCount: 4,
        refereeCount: 0,
        poolCount: 0,
        completedMatchCount: 0,
      });
    });
  });
});
