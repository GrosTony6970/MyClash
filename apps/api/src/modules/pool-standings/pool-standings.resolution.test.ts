import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { PoolStandingsService } from './pool-standings.service';
import { createFormulaRuleset, registry, TF_v1 } from '@myclash/rulesets';

/**
 * Ruleset RESOLUTION for standings — split out of pool-standings.service.test.ts
 * so neither file trips the 400-line cap in scripts/check-complexity.mjs.
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

describe('ruleset resolution', () => {
  function stubTournament(code: string, version: string) {
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: { id: 't-1', ruleset_code: code, ruleset_version: version },
          error: null,
        }),
      )
      .mockReturnValueOnce(makeChain({ data: { id: 'phase-1' }, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
  }

  it("scores and ranks an org-authored pool by the AUTHOR's formula, not TF_v1's", async () => {
    // Two regressions in one: (a) standings resolved via the in-memory
    // registry, which only holds the built-ins, so every custom ruleset 400'd
    // here; (b) the score column was filled by calling TF_v1's computeScore
    // directly, so even once resolved, an org pool was ranked by the federal
    // formula. This uses the SAME fixture as the TF_v1 test above — where
    // TF_v1 produces 5 and 1 — with a ruleset that scores 10 per victory.
    fromMock
      .mockReturnValueOnce(
        makeChain({
          data: { id: 't-1', ruleset_code: 'ORG_CUSTOM', ruleset_version: '1.0.0' },
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
              red_score: 2,
              blue_score: 1,
              winner_registration_id: 'reg-1',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeAwaitableChain({
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
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));

    const custom = createFormulaRuleset('ORG_CUSTOM', '1.0.0', 'Org Custom', {
      scoreFormula: {
        type: 'binop',
        op: '*',
        left: { type: 'var', name: 'victories' },
        right: { type: 'var', name: 'pointsPerVictory' },
      },
      constants: { pointsPerVictory: 10, pointsPerTie: 0, pointsPerLoss: 0, doublePenalty: 0 },
      tiebreakers: [{ variable: 'hitsReceived', direction: 'asc' }],
    });

    // The author's tiebreaker is projected onto a standings column, so the
    // API's applyRanking honours it (its own sort is discarded, and "overall"
    // re-ranks across pools anyway).
    expect(custom.rankingChain).toEqual([
      { key: 'score', direction: 'desc' },
      { key: 'hitsReceived', direction: 'asc' },
    ]);

    const service = new PoolStandingsService(
      mockSupabase as never,
      {
        resolve: async () => custom,
      } as never,
    );

    const result = (await service.getPoolStandings('t-1', 'overall')) as {
      rulesetCode: string;
      columns: Array<{ key: string }>;
      rows: Array<{ registrationId: string; rank: number; stats: Record<string, number> }>;
    };

    expect(result.rulesetCode).toBe('ORG_CUSTOM');
    expect(result.columns.map((c) => c.key)).toContain('score');

    const r1 = result.rows.find((r) => r.registrationId === 'reg-1')!;
    const r2 = result.rows.find((r) => r.registrationId === 'reg-2')!;

    // 10 and 0, not TF_v1's 5 and 1.
    expect(r1.stats['score']).toBe(10);
    expect(r2.stats['score']).toBe(0);
    expect(r1.rank).toBe(1);
    expect(r2.rank).toBe(2);
  });

  it('normalizes a legacy ruleset_version of "1" before resolving', async () => {
    stubTournament('TF_v1', '1');
    const resolve = vi.fn(async (code: string, version: string) =>
      registry.has(code, version) ? registry.get(code, version) : null,
    );
    const service = new PoolStandingsService(mockSupabase as never, { resolve } as never);

    await service.getPoolStandings('t-1', 'overall');

    // Tournaments predating the createTournament fix store the raw '1'. The
    // resolver's registry short-circuit is the ONLY path that can serve a
    // system ruleset (is_system rows never resolve from the DB), and it is
    // keyed on '1.0.0' — dropping this normalization breaks TF_v1 standings.
    expect(resolve).toHaveBeenCalledWith('TF_v1', '1.0.0');
  });

  it('still rejects a ruleset that resolves to null', async () => {
    fromMock.mockReturnValueOnce(
      makeChain({
        data: { id: 't-1', ruleset_code: 'NOPE', ruleset_version: '9.9.9' },
        error: null,
      }),
    );
    const service = new PoolStandingsService(
      mockSupabase as never,
      {
        resolve: async () => null,
      } as never,
    );

    await expect(service.getPoolStandings('t-1', 'overall')).rejects.toThrow(/not registered/);
  });
});
