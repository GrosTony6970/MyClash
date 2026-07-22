import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';

/**
 * Mock that returns a DIFFERENT penalty_rulesets row for the built-in lookup
 * (`.eq('built_in', true)`) than for the by-id getRuleset lookup, so a lineage
 * diff has two distinct sides to compare.
 */
function fakeSupabase(
  custom: Record<string, unknown> | null,
  builtin: Record<string, unknown> | null,
) {
  function chain() {
    let builtInQuery = false;
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === 'built_in' && val === true) builtInQuery = true;
        return api;
      }),
      is: vi.fn(() => api),
      limit: vi.fn(() => api),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: builtInQuery ? builtin : custom, error: null }),
      ),
    };
    return api;
  }
  return { service: { from: vi.fn(() => chain()) } };
}

const ENTRIES = [{ group_number: 1, ref_number: 'R1', sanctions: ['red'] }];

function builtinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'builtin-1',
    built_in: true,
    name: 'FFAMHE penalties',
    accumulation_scope: 'match',
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: 'match',
    second_black_card_forfeit: 'tournament',
    penalty_ruleset_entries: ENTRIES,
    ...overrides,
  };
}

describe('PenaltiesService.describeRulesetLineage', () => {
  it('returns null for the built-in itself (no parent to diff)', async () => {
    const supabase = fakeSupabase(builtinRow({ id: 'builtin-1' }), builtinRow());
    const service = new PenaltiesService(supabase as never);
    expect(await service.describeRulesetLineage('builtin-1')).toBeNull();
  });

  it('is unchanged when a custom ruleset matches the built-in default', async () => {
    const custom = builtinRow({ id: 'pr-1', built_in: false, name: 'My copy' });
    const supabase = fakeSupabase(custom, builtinRow());
    const service = new PenaltiesService(supabase as never);
    expect(await service.describeRulesetLineage('pr-1')).toEqual({
      base: 'FFAMHE penalties',
      status: 'unchanged',
    });
  });

  it('is changed when a custom ruleset diverges from the built-in (card cost edit)', async () => {
    const custom = builtinRow({ id: 'pr-1', built_in: false, red_card_points: -2 });
    const supabase = fakeSupabase(custom, builtinRow());
    const service = new PenaltiesService(supabase as never);
    expect(await service.describeRulesetLineage('pr-1')).toEqual({
      base: 'FFAMHE penalties',
      status: 'changed',
    });
  });

  it('returns null when there is no built-in to compare against', async () => {
    const custom = builtinRow({ id: 'pr-1', built_in: false });
    const supabase = fakeSupabase(custom, null);
    const service = new PenaltiesService(supabase as never);
    expect(await service.describeRulesetLineage('pr-1')).toBeNull();
  });
});
