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
    order: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
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
    order: vi.fn(),
    is: vi.fn(),
    or: vi.fn(),
  });
  for (const key of ['select', 'eq', 'in', 'order', 'is', 'or']) {
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
          data: [{ id: 'tournament-1', slug: 'longsword', name: 'Longsword', status: 'draft' }],
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
});
