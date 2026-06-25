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
    order: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const k of ['select', 'eq', 'in', 'order']) {
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
    order: vi.fn(),
  });
  for (const k of ['select', 'eq', 'in', 'order']) {
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
        },
      ],
      error: null,
    });
    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

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
});
