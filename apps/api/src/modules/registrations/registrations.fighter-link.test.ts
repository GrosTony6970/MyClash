import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mockSupabase as seededSupabase, writesTo } from '../../common/testing/supabase-chain';
import { RegistrationsService } from './registrations.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

// The global-identity match/mint now lives in GlobalPersonResolverService; the
// registration service just delegates. Mock it so these tests assert the
// delegation (right inputs, person linked to the returned id) without coupling
// to the resolver's internal query order.
const mockResolver = { resolveOrCreateGlobalPerson: vi.fn() };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'in', 'order', 'limit']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** Slice 2 added a capacity guard to create(); these fighter-linking tests
 *  don't exercise it, so they queue a tournament chain with null
 *  max_participants so the guard short-circuits. */
function noCapTournamentChain() {
  const chain = makeChain({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: { max_participants: null }, error: null });
  return chain;
}

function personRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'person-1',
    given_name: 'Jean',
    family_name: 'Dupont',
    club_id: 'club-1',
    date_of_birth: null,
    email: null,
    hema_ratings_id: null,
    global_person_id: null,
    ...overrides,
  };
}

describe('RegistrationsService fighter linking', () => {
  let service: RegistrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RegistrationsService(mockSupabase as never, mockResolver as never);
  });

  it('delegates to the resolver (mint) when the person has no global identity', async () => {
    mockResolver.resolveOrCreateGlobalPerson.mockResolvedValue({ id: 'fighter-1', created: true });

    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({ data: personRow(), error: null });

    const personUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', person_id: 'person-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain) // persons.select
      .mockReturnValueOnce(personUpdateChain) // persons.update global_person_id
      .mockReturnValueOnce(noCapTournamentChain()) // Slice 2: capacity guard
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    const result = await service.create('tournament-1', { personId: 'person-1' });

    expect(result['id']).toBe('reg-1');
    expect(mockResolver.resolveOrCreateGlobalPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        givenName: 'Jean',
        familyName: 'Dupont',
        clubId: 'club-1',
        hemaRatingsId: null,
      }),
    );
    // The person row is linked to the id the resolver returned.
    expect(personUpdateChain.update).toHaveBeenCalledWith({ global_person_id: 'fighter-1' });
    expect(regChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: 'person-1' }),
    );
    expect(regChain.insert.mock.calls[0]?.[0]).not.toHaveProperty('fighter_id');
  });

  it('reuses the existing global identity the resolver returns (no duplicate mint)', async () => {
    // Resolver matched an existing global person (created: false) — e.g. the same
    // fighter already registered in another event. Registration must link to it.
    mockResolver.resolveOrCreateGlobalPerson.mockResolvedValue({
      id: 'existing-gp',
      created: false,
    });

    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({ data: personRow(), error: null });

    const personUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', person_id: 'person-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(personUpdateChain)
      .mockReturnValueOnce(noCapTournamentChain())
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', { personId: 'person-1' });

    expect(personUpdateChain.update).toHaveBeenCalledWith({ global_person_id: 'existing-gp' });
  });

  it('passes a registration-time hema_ratings_id through to the resolver', async () => {
    mockResolver.resolveOrCreateGlobalPerson.mockResolvedValue({ id: 'fighter-1', created: true });

    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({ data: personRow(), error: null });

    const personUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', person_id: 'person-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(personUpdateChain)
      .mockReturnValueOnce(noCapTournamentChain())
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', { personId: 'person-1', hemaRatingsId: '123' } as never);

    expect(mockResolver.resolveOrCreateGlobalPerson).toHaveBeenCalledWith(
      expect.objectContaining({ hemaRatingsId: '123' }),
    );
  });

  // An entry never writes onto the global profile its person is linked to
  // (operator ruling 35, 2026-09-22). Other Events and the fighter share that
  // profile, and only the fighter or a super admin may change it — as RLS
  // `global_persons_update` says. It used to take the entry's HEMA Ratings id, so
  // any organiser could change a stranger's rank. The roster page sends the
  // typed id, or null for an empty field (ruling 32); neither reaches it. The
  // profile has no id on file, so even a fill-only-if-empty would write.
  it.each([
    ['a HEMA Ratings id', '456'],
    ['null', null],
  ])(
    'writes nothing onto the linked global profile when the entry carries %s',
    async (_label, hemaRatingsId) => {
      const db = seededSupabase({
        persons: { rows: [personRow({ global_person_id: 'fighter-1' })] },
        global_persons: { rows: [{ id: 'fighter-1', hema_ratings_id: null }] },
        tournaments: { rows: [{ id: 'tournament-1', max_participants: null }] },
        registrations: { rows: [], returning: { id: 'reg-1' } },
      });
      const linked = new RegistrationsService(db as never, mockResolver as never);

      await linked.create('tournament-1', { personId: 'person-1', hemaRatingsId });

      // Already linked → the resolver is not consulted.
      expect(mockResolver.resolveOrCreateGlobalPerson).not.toHaveBeenCalled();
      expect(writesTo(db, 'global_persons')).toEqual([]);
      expect(writesTo(db, 'registrations')).toHaveLength(1);
    },
  );

  it("passes an unlinked person's own HEMA Ratings id to the resolver when the body's is null", async () => {
    mockResolver.resolveOrCreateGlobalPerson.mockResolvedValue({ id: 'fighter-1', created: false });
    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({
      data: personRow({ hema_ratings_id: '789' }),
      error: null,
    });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({ data: { id: 'reg-1' }, error: null });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(noCapTournamentChain())
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', { personId: 'person-1', hemaRatingsId: null });

    expect(mockResolver.resolveOrCreateGlobalPerson).toHaveBeenCalledWith(
      expect.objectContaining({ hemaRatingsId: '789' }),
    );
  });
});
