import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDashboardStatsService } from './admin-dashboard-stats.service';

const fromMock = vi.fn();
const countAuthAdminUsersMock = vi.fn();

const mockSupabase = {
  service: {
    from: fromMock,
  },
  countAuthAdminUsers: countAuthAdminUsersMock,
};

type CountResult = { count: number | null; error: unknown };

function makeCountChain(result: CountResult) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    gte: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.neq.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  return chain;
}

describe('AdminDashboardStatsService', () => {
  let service: AdminDashboardStatsService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
    fromMock.mockReturnValue(makeCountChain({ count: 0, error: null }));
    countAuthAdminUsersMock.mockResolvedValue({
      ok: true,
      data: { total: 0 },
      status: 200,
      detail: {},
    });
    service = new AdminDashboardStatsService(mockSupabase as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates platform totals and 30-day activity', async () => {
    const counts = [
      4, 3, 1, 8, 2, 3, 3, 12, 5, 4, 120, 90, 250, 42, 320, 900, 760, 5600, 1, 2, 3, 4, 55, 42, 3,
    ];
    fromMock.mockImplementation(() => makeCountChain({ count: counts.shift() ?? 0, error: null }));
    countAuthAdminUsersMock.mockResolvedValue({
      ok: true,
      data: { total: 1234 },
      status: 200,
      detail: {},
    });

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
    expect(stats.clubs).toEqual({ total: 42 });
    expect(stats.leagues).toEqual({ total: 3 });
    expect(stats.platformUsers).toEqual({ total: 1234 });
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

  /**
   * The platform dashboard is the ONE surface where a club event counts. Every
   * other aggregate (fighter career, referee career, league standings, group
   * member cards) gates on countsTowardStats and admits only 'standard'; this
   * one gates on countsAsPlatformActivity and admits 'standard' + 'club',
   * because a club night is real activity on the platform while a dry run is
   * not. These assertions exist to break a "unify the two predicates" refactor.
   */
  describe('event-kind gate — excludes test, INCLUDES club', () => {
    const kindCalls = () =>
      fromMock.mock.results
        .map((result) => result.value as { neq?: ReturnType<typeof vi.fn> })
        .filter((chain) => chain.neq)
        .flatMap((chain) => chain.neq!.mock.calls)
        .filter((call) => String(call[0]).endsWith('event_kind'));

    it('filters every counter on event_kind <> test', async () => {
      await service.getStats();

      const calls = kindCalls();
      // Direct on events, plus the three embed depths.
      expect(calls).toEqual(
        expect.arrayContaining([
          ['event_kind', 'test'],
          ['events.event_kind', 'test'],
          ['phases.tournaments.events.event_kind', 'test'],
          ['matches.phases.tournaments.events.event_kind', 'test'],
        ]),
      );
      // Every kind filter is the same exclusion — no counter drifted to a
      // different value.
      expect(calls.every((call) => call[1] === 'test')).toBe(true);
    });

    it('never excludes club events, and never narrows to standard only', async () => {
      await service.getStats();

      expect(kindCalls().some((call) => call[1] === 'club')).toBe(false);

      const eqKindCalls = fromMock.mock.results
        .map((result) => result.value as { eq?: ReturnType<typeof vi.fn> })
        .filter((chain) => chain.eq)
        .flatMap((chain) => chain.eq!.mock.calls)
        .filter((call) => String(call[0]).endsWith('event_kind'));
      expect(eqKindCalls).toEqual([]);
    });
  });
});
