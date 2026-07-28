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

/**
 * The list form of the same computation, powering the lamps on the Discover
 * cards and the Manage rows. It must read the baseline ONCE for the whole list
 * and hand every row the same signal the single-ruleset endpoint would.
 */
function listSupabase(rows: Array<Record<string, unknown>>, builtin: Record<string, unknown>) {
  function chain() {
    let builtInQuery = false;
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      or: vi.fn(() => api),
      in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === 'built_in' && val === true) builtInQuery = true;
        return api;
      }),
      is: vi.fn(() => api),
      limit: vi.fn(() => api),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: builtInQuery ? builtin : null, error: null }),
      ),
      order: vi.fn(() => api),
    };
    api['then'] = (resolve: (value: unknown) => unknown) =>
      resolve({ data: builtInQuery ? [builtin] : rows, error: null });
    return api;
  }
  return { service: { from: vi.fn(() => chain()) } };
}

describe('PenaltiesService.listRulesetCatalogForOrg lineage', () => {
  it('lamps every custom row against the built-in, and none on the built-in itself', async () => {
    const builtin = builtinRow();
    const supabase = listSupabase(
      [
        { ...builtin, owner_organization_id: null, public_visibility: false, code: 'ffamhe' },
        {
          ...builtinRow({
            id: 'pr-2',
            built_in: false,
            name: 'Club rules',
            red_card_points: -3,
          }),
          code: 'club',
          version: '1.0.0',
          description: null,
          owner_organization_id: 'org-x',
          public_visibility: true,
        },
      ],
      builtin,
    );
    const service = new PenaltiesService(supabase as never);
    // assertUserCanManageOrg is exercised elsewhere; bypass it here so the test
    // is about the lineage, not the gate.
    vi.spyOn(
      service as unknown as { assertUserCanManageOrg: () => Promise<void> },
      'assertUserCanManageOrg',
    ).mockResolvedValue(undefined);

    const result = await service.listRulesetCatalogForOrg('org-me', 'user-1');

    expect(result[0]?.lineage).toBeNull();
    expect(result[1]?.lineage).toEqual({ base: 'FFAMHE penalties', status: 'changed' });
  });
});
