import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { PoolStandingsService } from './pool-standings.service';
import { registry, TF_v1 } from '@myclash/rulesets';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const k of ['select', 'eq', 'in', 'is', 'order']) {
    (chain as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeAwaitableChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
  });
  for (const k of ['select', 'eq', 'in', 'is', 'order']) {
    (chain as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('PoolStandingsService', () => {
  beforeAll(() => {
    if (!registry.has('TF_v1', '1.0.0')) {
      registry.register(TF_v1);
    }
  });

  afterAll(() => {
    registry.clear();
  });

  it('returns empty rows and the ruleset columns when no matches are completed', async () => {
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({ data: [], error: null });
    const matchesChain = makeAwaitableChain({ data: [], error: null });

    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    const result = await service.getPoolStandings('t-1', 'overall');

    expect(result.rulesetCode).toBe('TF_v1');
    expect(result.columns.length).toBeGreaterThan(0);
    expect(Array.isArray((result as { rows?: unknown[] }).rows)).toBe(true);
    expect((result as { rows: unknown[] }).rows.length).toBe(0);
  });

  it('does not request persons.display_name (column does not exist on persons)', async () => {
    // Regression guard: persons has only given_name + family_name; the
    // display_name column lives on global_persons. PostgREST returns
    // 400 if we embed persons(display_name). See scoreboard 400 fix.
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({ data: [], error: null });
    const matchesChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    await service.getPoolStandings('t-1', 'overall');

    const selectArg = String((poolsChain.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(selectArg).toContain('persons(id, given_name, family_name');
    expect(selectArg).not.toContain('display_name');
  });

  it('composes displayName from given_name + family_name', async () => {
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({
      data: [
        {
          id: 'pool-1',
          name: 'Pool A',
          pool_members: [
            {
              registration_id: 'reg-1',
              registrations: {
                id: 'reg-1',
                persons: {
                  id: 'p-1',
                  given_name: 'Jean',
                  family_name: 'Dupont',
                  clubs: null,
                },
              },
            },
          ],
        },
      ],
      error: null,
    });
    const matchesChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    const result = (await service.getPoolStandings('t-1', 'overall')) as {
      rows: Array<{ displayName: string }>;
    };

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.displayName).toBe('Jean Dupont');
  });

  it('does not select matches.scoring_payload (column does not exist)', async () => {
    // Regression guard: there is no scoring_payload column on matches. Selecting
    // it makes PostgREST 400 the whole query; that error used to be swallowed,
    // zeroing every pool's standings and making pools never "complete".
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({ data: [], error: null });
    const matchesChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    await service.getPoolStandings('t-1', 'overall');

    const selectArg = String((matchesChain.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(selectArg).toContain('red_score');
    expect(selectArg).not.toContain('scoring_payload');
  });

  it('throws if the matches query errors (never silently zeroes standings)', async () => {
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({ data: [], error: null });
    const matchesChain = makeAwaitableChain({
      data: null,
      error: { message: 'column matches.scoring_payload does not exist' },
    });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    await expect(service.getPoolStandings('t-1', 'overall')).rejects.toThrow(/does not exist/);
  });

  it('marks a pool completed and tallies W/points from completed matches', async () => {
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({
      data: [
        {
          id: 'pool-1',
          name: 'Pool A',
          pool_members: [
            {
              registration_id: 'reg-1',
              registrations: {
                id: 'reg-1',
                persons: { id: 'p-1', given_name: 'A', family_name: 'One', clubs: null },
              },
            },
            {
              registration_id: 'reg-2',
              registrations: {
                id: 'reg-2',
                persons: { id: 'p-2', given_name: 'B', family_name: 'Two', clubs: null },
              },
            },
          ],
        },
      ],
      error: null,
    });
    const matchesChain = makeAwaitableChain({
      data: [
        {
          id: 'm1',
          pool_id: 'pool-1',
          status: 'completed',
          red_registration_id: 'reg-1',
          blue_registration_id: 'reg-2',
          red_score: 5,
          blue_score: 2,
          winner_registration_id: 'reg-1',
        },
      ],
      error: null,
    });
    const exchangesChain = makeAwaitableChain({ data: [], error: null });
    const forfeitsChain = makeAwaitableChain({ data: [], error: null });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain)
      .mockReturnValueOnce(exchangesChain)
      .mockReturnValueOnce(forfeitsChain);

    const service = new PoolStandingsService(mockSupabase as never);
    const result = (await service.getPoolStandings('t-1', 'by-pool')) as {
      pools: Array<{
        status: string;
        rows: Array<{ registrationId: string; stats: Record<string, number> }>;
      }>;
    };

    expect(result.pools).toHaveLength(1);
    expect(result.pools[0]!.status).toBe('completed');
    const winner = result.pools[0]!.rows.find((r) => r.registrationId === 'reg-1')!;
    expect(winner.stats['W']).toBe(1);
    expect(winner.stats['ptsScored']).toBe(5);
    expect(winner.stats['ptsConceded']).toBe(2);
  });

  it('derives hitsGiven/hitsReceived/doubles/score from exchanges + F from forfeits, ranked by score', () => {
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
      error: null,
    });
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    const poolsChain = makeAwaitableChain({
      data: [
        {
          id: 'pool-1',
          name: 'Pool A',
          pool_members: [
            {
              registration_id: 'reg-1',
              registrations: {
                id: 'reg-1',
                persons: { id: 'p-1', given_name: 'A', family_name: 'One', clubs: null },
              },
            },
            {
              registration_id: 'reg-2',
              registrations: {
                id: 'reg-2',
                persons: { id: 'p-2', given_name: 'B', family_name: 'Two', clubs: null },
              },
            },
          ],
        },
      ],
      error: null,
    });
    const matchesChain = makeAwaitableChain({
      data: [
        {
          id: 'm1',
          pool_id: 'pool-1',
          status: 'completed',
          red_registration_id: 'reg-1',
          blue_registration_id: 'reg-2',
          red_score: 2,
          blue_score: 1,
          winner_registration_id: 'reg-1',
        },
      ],
      error: null,
    });
    // reg-1 (red) clean 2; reg-2 (blue) clean 1; one double.
    const exchangesChain = makeAwaitableChain({
      data: [
        {
          match_id: 'm1',
          type: 'clean',
          first_striker_color: 'red',
          first_strike_value: 2,
          afterblow_value: null,
          voided: false,
        },
        {
          match_id: 'm1',
          type: 'clean',
          first_striker_color: 'blue',
          first_strike_value: 1,
          afterblow_value: null,
          voided: false,
        },
        {
          match_id: 'm1',
          type: 'double',
          first_striker_color: null,
          first_strike_value: null,
          afterblow_value: null,
          voided: false,
        },
      ],
      error: null,
    });
    const forfeitsChain = makeAwaitableChain({
      data: [{ forfeiting_registration_id: 'reg-2', match_id: 'm1' }],
      error: null,
    });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain)
      .mockReturnValueOnce(exchangesChain)
      .mockReturnValueOnce(forfeitsChain);

    const service = new PoolStandingsService(mockSupabase as never);
    return service.getPoolStandings('t-1', 'by-pool').then((result) => {
      const pool = (
        result as {
          pools: Array<{
            rows: Array<{ rank: number; registrationId: string; stats: Record<string, number> }>;
          }>;
        }
      ).pools[0]!;
      const r1 = pool.rows.find((r) => r.registrationId === 'reg-1')!;
      const r2 = pool.rows.find((r) => r.registrationId === 'reg-2')!;

      // reg-1: targetPoints 2, timesHit 1, doubles 1, win → (3+2)/(1+0) = 5
      expect(r1.stats['hitsGiven']).toBe(2);
      expect(r1.stats['hitsReceived']).toBe(1);
      expect(r1.stats['doubles']).toBe(1);
      expect(r1.stats['score']).toBe(5);
      expect(r1.stats['F']).toBe(0);

      // reg-2: targetPoints 1, timesHit 1, doubles 1, loss → (0+1)/(1+0) = 1
      expect(r2.stats['hitsGiven']).toBe(1);
      expect(r2.stats['hitsReceived']).toBe(1);
      expect(r2.stats['doubles']).toBe(1);
      expect(r2.stats['score']).toBe(1);
      expect(r2.stats['F']).toBe(1);

      // Ranked by score (5 > 1).
      expect(r1.rank).toBe(1);
      expect(r2.rank).toBe(2);
    });
  });
});
