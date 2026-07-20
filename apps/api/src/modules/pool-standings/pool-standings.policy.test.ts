import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { PoolStandingsService } from './pool-standings.service';
import { registry, TF_v1 } from '@myclash/rulesets';

/**
 * tournamentPolicy behaviour in standings — split from the resolution suite so
 * neither file trips the 400-line cap in scripts/check-complexity.mjs.
 */
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

beforeAll(() => {
  if (!registry.has('TF_v1', '1.0.0')) registry.register(TF_v1);
});

afterAll(() => {
  registry.clear();
});

describe('standings — tournamentPolicy', () => {
  it('counts a forfeited match as a draw when tournamentPolicy.forfeitDrawsCount is on', async () => {
    // "Forfeit counts as draw". W/L/D derive from red_score vs blue_score, and a
    // forfeit sets those via scorePolicy (0 vs 6 here), so without the policy
    // reg-1 takes the win. Nothing read this switch before.
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 't-1',
            ruleset_code: 'TF_v1',
            ruleset_version: '1.0.0',
            ruleset_config: { tournamentPolicy: { forfeitDrawsCount: true } },
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(makeChain({ data: { id: 'phase-1' }, error: null }))
      .mockReturnValueOnce(
        makeAwaitableChain({
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
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            {
              id: 'm1',
              pool_id: 'pool-1',
              status: 'completed',
              red_registration_id: 'reg-1',
              blue_registration_id: 'reg-2',
              red_score: 6,
              blue_score: 0,
              winner_registration_id: 'reg-1',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ forfeiting_registration_id: 'reg-2', match_id: 'm1' }],
          error: null,
        }),
      );

    const service = new PoolStandingsService(
      mockSupabase as never,
      {
        resolve: async (code: string, version: string) =>
          registry.has(code, version) ? registry.get(code, version) : null,
      } as never,
    );

    const result = (await service.getPoolStandings('t-1', 'overall')) as {
      rows: Array<{ registrationId: string; stats: Record<string, number> }>;
    };
    const r1 = result.rows.find((r) => r.registrationId === 'reg-1')!;
    const r2 = result.rows.find((r) => r.registrationId === 'reg-2')!;

    expect(r1.stats['D']).toBe(1);
    expect(r2.stats['D']).toBe(1);
    expect(r1.stats['W']).toBe(0);
    expect(r2.stats['L']).toBe(0);
  });
});
