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
});
