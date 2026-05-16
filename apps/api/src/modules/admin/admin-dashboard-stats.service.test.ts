import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDashboardStatsService } from './admin-dashboard-stats.service';

const fromMock = vi.fn();

const mockSupabase = {
  service: {
    from: fromMock,
  },
};

type CountResult = { count: number | null; error: unknown };

function makeCountChain(result: CountResult) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    in: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  return chain;
}

describe('AdminDashboardStatsService', () => {
  let service: AdminDashboardStatsService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
    fromMock.mockReturnValue(makeCountChain({ count: 0, error: null }));
    service = new AdminDashboardStatsService(mockSupabase as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates platform totals and 30-day activity', async () => {
    const counts = [
      4, 3, 1, 8, 2, 3, 3, 12, 5, 4, 120, 90, 250, 42, 320, 900, 760, 5600, 1, 2, 3, 4, 55,
    ];
    fromMock.mockImplementation(() => makeCountChain({ count: counts.shift() ?? 0, error: null }));

    const stats = await service.getStats();

    expect(stats.generatedAt).toBe('2026-05-16T12:00:00.000Z');
    expect(stats.organizations).toEqual({ total: 4, active: 3, suspended: 1 });
    expect(stats.events).toEqual({
      total: 8,
      draft: 2,
      publishedOrRunning: 3,
      completed: 3,
    });
    expect(stats.tournaments).toEqual({ total: 12, draft: 5, active: 3, completed: 4 });
    expect(stats.people).toEqual({
      globalPersons: 120,
      fighters: 90,
      eventPersons: 250,
      claimedProfiles: 42,
    });
    expect(stats.activity).toEqual({
      registrations: 320,
      matches: 900,
      completedMatches: 760,
      exchanges: 5600,
    });
    expect(stats.recent).toEqual({
      days: 30,
      newOrganizations: 1,
      newEvents: 2,
      newTournaments: 3,
      newGlobalPersons: 4,
      completedMatches: 55,
    });
  });

  it('returns zero for count failures without failing the whole dashboard', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeCountChain({ count: null, error: { message: 'missing' } });
      return makeCountChain({ count: 2, error: null });
    });

    const stats = await service.getStats();

    expect(stats.events.total).toBe(0);
    expect(stats.events.draft).toBe(0);
    expect(stats.organizations.total).toBe(2);
  });

  it('filters recent counts from the last 30 days', async () => {
    await service.getStats();

    const gteCalls = fromMock.mock.results
      .map((result) => result.value as { gte?: ReturnType<typeof vi.fn> })
      .filter((chain) => chain.gte)
      .flatMap((chain) => chain.gte!.mock.calls);

    expect(gteCalls).toEqual(
      expect.arrayContaining([
        ['created_at', '2026-04-16T12:00:00.000Z'],
        ['ended_at', '2026-04-16T12:00:00.000Z'],
      ]),
    );
  });

  it('counts fighters using global_persons.is_fighter', async () => {
    await service.getStats();

    const globalPersonChains = fromMock.mock.results
      .filter((_, index) => fromMock.mock.calls[index]?.[0] === 'global_persons')
      .map((result) => result.value as { eq: ReturnType<typeof vi.fn> });

    expect(globalPersonChains.flatMap((chain) => chain.eq.mock.calls)).toContainEqual([
      'is_fighter',
      true,
    ]);
  });
});
