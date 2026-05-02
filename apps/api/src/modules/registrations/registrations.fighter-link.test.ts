import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RegistrationsService } from './registrations.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
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
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'order', 'limit']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('RegistrationsService fighter linking', () => {
  let service: RegistrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RegistrationsService(mockSupabase as never);
  });

  it('creates a Fighter without hema_ratings_id when Person has no Fighter and no HEMA profile is selected', async () => {
    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({
      data: {
        id: 'person-1',
        given_name: 'Jean',
        family_name: 'Dupont',
        club_id: 'club-1',
        global_fighter_id: null,
      },
      error: null,
    });

    const fighterChain = makeChain({ data: null, error: null });
    fighterChain.single.mockResolvedValue({
      data: { id: 'fighter-1', hema_ratings_id: null },
      error: null,
    });

    const personUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', fighter_id: 'fighter-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(fighterChain)
      .mockReturnValueOnce(personUpdateChain)
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    const result = await service.create('tournament-1', { personId: 'person-1' });

    expect((result as { fighter_id: string }).fighter_id).toBe('fighter-1');
    expect(fighterChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: 'Jean Dupont',
        given_name: 'Jean',
        family_name: 'Dupont',
        club_id: 'club-1',
        hema_ratings_id: null,
      }),
    );
    expect(regChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fighter_id: 'fighter-1' }),
    );
  });

  it('creates a Fighter with hema_ratings_id when selected during registration', async () => {
    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({
      data: {
        id: 'person-1',
        given_name: 'Jean',
        family_name: 'Dupont',
        club_id: 'club-1',
        global_fighter_id: null,
      },
      error: null,
    });

    const fighterChain = makeChain({ data: null, error: null });
    fighterChain.single.mockResolvedValue({
      data: { id: 'fighter-1', hema_ratings_id: '123' },
      error: null,
    });

    const personUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', fighter_id: 'fighter-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(fighterChain)
      .mockReturnValueOnce(personUpdateChain)
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', {
      personId: 'person-1',
      hemaRatingsId: '123',
    } as never);

    expect(fighterChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ hema_ratings_id: '123' }),
    );
  });

  it('reuses existing Fighter and updates hema_ratings_id only when provided', async () => {
    const personChain = makeChain({ data: null, error: null });
    personChain.maybeSingle.mockResolvedValue({
      data: {
        id: 'person-1',
        given_name: 'Jean',
        family_name: 'Dupont',
        club_id: 'club-1',
        global_fighter_id: 'fighter-1',
      },
      error: null,
    });

    const fighterUpdateChain = makeChain({ data: null, error: null });
    const bibChain = makeAwaitableChain({ data: [], error: null });
    const regChain = makeChain({ data: null, error: null });
    regChain.single.mockResolvedValue({
      data: { id: 'reg-1', fighter_id: 'fighter-1' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(personChain)
      .mockReturnValueOnce(fighterUpdateChain)
      .mockReturnValueOnce(bibChain)
      .mockReturnValueOnce(regChain);

    await service.create('tournament-1', {
      personId: 'person-1',
      hemaRatingsId: '456',
    } as never);

    expect(fighterUpdateChain.update).toHaveBeenCalledWith({ hema_ratings_id: '456' });
    expect(regChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fighter_id: 'fighter-1' }),
    );
  });
});
