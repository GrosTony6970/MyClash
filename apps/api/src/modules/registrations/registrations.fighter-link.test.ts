import { describe, expect, it, vi, beforeEach } from 'vitest';
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

  it('reuses an already-linked global person and updates hema_ratings_id only when provided', async () => {
    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({
      data: personRow({ global_person_id: 'fighter-1' }),
      error: null,
    });

    const fighterUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', person_id: 'person-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain) // persons.select (global_person_id already set)
      .mockReturnValueOnce(fighterUpdateChain) // global_persons.update hema_ratings_id
      .mockReturnValueOnce(noCapTournamentChain())
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', { personId: 'person-1', hemaRatingsId: '456' } as never);

    // Already linked → resolver is not consulted.
    expect(mockResolver.resolveOrCreateGlobalPerson).not.toHaveBeenCalled();
    expect(fighterUpdateChain.update).toHaveBeenCalledWith({ hema_ratings_id: '456' });
    expect(regChain.insert.mock.calls[0]?.[0]).not.toHaveProperty('fighter_id');
  });
});
