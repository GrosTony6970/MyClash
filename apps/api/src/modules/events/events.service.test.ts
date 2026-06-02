import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
  });
  for (const key of ['select', 'eq', 'in', 'neq', 'order', 'is', 'or']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
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
    const deleteChain = makeChain({ data: null, error: null });
    fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(deleteChain);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).resolves.toEqual({
      deleted: true,
      id: 'event-1',
    });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'event-1');
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
            location: 'Lyon',
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
      .mockReturnValueOnce(makeAwaitableChain({ count: 3, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      // NEW: getPhasesForTournaments — empty in this fixture so no pools
      // count query follows. Per-tournament poolCount=0, bracketSize=null.
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.getEventDashboardStats('event-1', 'user-1')).resolves.toMatchObject({
      totals: {
        tournaments: 1,
        registeredFighters: 1,
        qualifiedReferees: 3,
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
            location: 'Lyon',
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
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null }))
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
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null }))
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
        .mockReturnValueOnce(makeAwaitableChain({ data: clubs, error: null }));

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
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }));

      const result = await service.listPublicParticipants('fal-2027');

      expect(result.map((r) => r.personId)).toEqual(['p2']);
      // Withdrawn / disqualified must never be in the status filter list.
      expect(regChain.in).toHaveBeenCalledWith('status', ['registered', 'checked_in']);
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
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }));

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
        .mockReturnValueOnce(makeAwaitableChain({ data: persons, error: null }));

      const result = await service.listPublicParticipants('fal-2027');
      expect(result[0]?.tournaments[0]?.registrationState).toBe('active');
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
            brand_color: '#c0392b',
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
        { event_id: 'event-pub' },
        { event_id: 'event-pub' },
        { event_id: 'event-pub' },
        { event_id: 'event-pub-2' },
      ];
      const eventsChain = makeAwaitableChain({ data: rows, error: null });
      const tournamentsChain = makeAwaitableChain({ data: tournaments, error: null });
      fromMock.mockReturnValueOnce(eventsChain).mockReturnValueOnce(tournamentsChain);

      const result = (await service.listEvents({})) as Array<{
        id: string;
        tournament_count: number;
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

      fromMock.mockImplementation((table: string) => {
        if (table === 'tournaments') return tournamentsChain;
        if (table === 'registrations') return registrationsChain;
        throw new Error(`unexpected table ${table}`);
      });

      const result = (await service.listTournaments('event-1')) as Array<{
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
});
