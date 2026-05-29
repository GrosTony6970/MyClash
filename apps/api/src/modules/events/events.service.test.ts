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

  // ── Public listEvents — drives /api/v1/events used by the public site root.
  // Locks the SELECT shape + status filter that the public landing page
  // depends on. The "unavailable" banner at app.myclash.fr/ only renders
  // when this endpoint fails — keeping the contract here pinned guards
  // against silent regressions.
  describe('listEvents (public)', () => {
    it('returns published / running / completed events with org name+slug joined', async () => {
      const rows = [
        {
          id: 'event-pub',
          name: 'Lyon Spring',
          status: 'published',
          start_date: '2026-06-01',
          end_date: '2026-06-02',
          organizations: { name: 'Lyon AMHE', slug: 'lyon-amhe' },
        },
      ];
      const chain = makeAwaitableChain({ data: rows, error: null });
      fromMock.mockReturnValueOnce(chain);

      const result = (await service.listEvents({})) as typeof rows;

      expect(result).toEqual(rows);
      // Public landing page relies on the joined organization name/slug;
      // dropping either breaks the card subtitle on app.myclash.fr/.
      expect(chain.select).toHaveBeenCalledWith('*, organizations(name, slug)');
      // Default status filter when no `status` arg is given.
      expect(chain.in).toHaveBeenCalledWith('status', ['published', 'running', 'completed']);
      // Newest events first so the freshly-published event lands at the
      // top of the public list immediately after the admin publish.
      expect(chain.order).toHaveBeenCalledWith('start_date', { ascending: false });
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
});
