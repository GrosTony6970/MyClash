import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService, bumpPenaltyVersion } from './penalties.service';

type TableState = Record<
  string,
  {
    maybeSingle?: unknown;
    single?: unknown;
    select?: unknown[];
    insert?: unknown;
    update?: unknown;
    count?: number;
  }
>;

function fakeSupabase(state: TableState) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};
  const deleted: string[] = [];
  function chain(table: string) {
    const t = state[table] ?? {};
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      in: vi.fn(() => api),
      is: vi.fn(() => api),
      order: vi.fn(() => Promise.resolve({ data: t.select ?? [], error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: t.maybeSingle ?? null, error: null })),
      single: vi.fn(() =>
        Promise.resolve({ data: t.single ?? t.insert ?? t.update ?? null, error: null }),
      ),
      insert: vi.fn((row: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), row];
        return api;
      }),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        return api;
      }),
      delete: vi.fn(() => {
        deleted.push(table);
        return api;
      }),
      // Bare `.select().eq()` count queries and bare `.update()/.delete().eq()`
      // resolve here (per-table `count` drives the reference guard).
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [], count: t.count ?? 0, error: null }),
    };
    return api;
  }
  return { inserted, updated, deleted, service: { from: vi.fn((table: string) => chain(table)) } };
}

const ENTRIES = [
  {
    id: 'e1',
    group_number: 3,
    ref_number: '6',
    short_name: 'Non-combativité',
    description: 'Insufficient offensive action',
    sanctions: ['yellow', 'red', 'red', 'black'],
    sort_order: 1,
  },
  {
    id: 'e2',
    group_number: 1,
    ref_number: 'R7a',
    short_name: 'Coup interdit',
    description: 'Forbidden strike',
    sanctions: ['red'],
    sort_order: 2,
  },
];

function rulesetFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr-1',
    built_in: false,
    owner_organization_id: 'org-1',
    version: '1.0.0',
    name: 'Custom penalties',
    description: null,
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

function makeService(state: TableState) {
  const supabase = fakeSupabase(state);
  const service = new PenaltiesService(supabase as never);
  return { service, supabase };
}

describe('PenaltiesService — publish (snapshot + version bump)', () => {
  it('snapshots the current definition + entries and patch-bumps the parent version', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
    });

    await service.publishRuleset('pr-1', 'user-1');

    const snap = supabase.inserted.penalty_ruleset_versions?.[0] as Record<string, unknown>;
    expect(snap).toMatchObject({
      penalty_ruleset_id: 'pr-1',
      version: '1.0.0',
      accumulation_scope: 'match',
      red_card_points: -1,
      first_black_card_forfeit: 'match',
      published_by_user_id: 'user-1',
    });
    // Entries serialised as an ordered, camelCased JSONB array.
    expect(snap.entries).toEqual([
      {
        groupNumber: 3,
        refNumber: '6',
        shortName: 'Non-combativité',
        description: 'Insufficient offensive action',
        sanctions: ['yellow', 'red', 'red', 'black'],
        sortOrder: 1,
      },
      {
        groupNumber: 1,
        refNumber: 'R7a',
        shortName: 'Coup interdit',
        description: 'Forbidden strike',
        sanctions: ['red'],
        sortOrder: 2,
      },
    ]);
    // Parent version patch-bumped so subsequent edits target a fresh slot.
    expect(supabase.updated.penalty_rulesets?.[0]).toMatchObject({ version: '1.0.1' });
  });

  it('honours an explicit next version over the auto patch-bump', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
    });

    await service.publishRuleset('pr-1', 'user-1', '2.0.0');

    expect(supabase.updated.penalty_rulesets?.[0]).toMatchObject({ version: '2.0.0' });
  });

  it('refuses to publish the built-in ruleset', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture({ built_in: true }) },
    });

    await expect(service.publishRuleset('pr-1', 'user-1')).rejects.toThrow(/always published/i);
    expect(supabase.inserted.penalty_ruleset_versions).toBeUndefined();
  });

  it('rejects an empty ruleset without writing a snapshot or bumping', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture({ penalty_ruleset_entries: [] }) },
    });

    await expect(service.publishRuleset('pr-1', 'user-1')).rejects.toThrow(/at least one entry/i);
    expect(supabase.inserted.penalty_ruleset_versions).toBeUndefined();
    expect(supabase.updated.penalty_rulesets).toBeUndefined();
  });

  it('rejects a duplicate REF and an invalid sanction card', async () => {
    const { service } = makeService({
      penalty_rulesets: {
        maybeSingle: rulesetFixture({
          penalty_ruleset_entries: [
            {
              group_number: 1,
              ref_number: 'R1',
              short_name: 'a',
              description: '',
              sanctions: ['yellow'],
              sort_order: 1,
            },
            {
              group_number: 1,
              ref_number: 'R1',
              short_name: 'b',
              description: '',
              sanctions: ['purple'],
              sort_order: 2,
            },
          ],
        }),
      },
    });

    await expect(service.publishRuleset('pr-1', 'user-1')).rejects.toThrow(
      /duplicated|invalid sanction/i,
    );
  });
});

describe('PenaltiesService — rollback + listVersions', () => {
  const SNAPSHOT = {
    id: 'ver-1',
    penalty_ruleset_id: 'pr-1',
    version: '1.0.0',
    name: 'Older name',
    description: 'older',
    accumulation_scope: 'tournament',
    yellow_card_points: -1,
    red_card_points: -2,
    black_card_points: -3,
    first_black_card_forfeit: 'tournament',
    second_black_card_forfeit: 'none',
    entries: [
      {
        groupNumber: 2,
        refNumber: 'X1',
        shortName: 's1',
        description: 'd1',
        sanctions: ['yellow'],
        sortOrder: 1,
      },
      {
        groupNumber: 5,
        refNumber: 'X2',
        shortName: 's2',
        description: 'd2',
        sanctions: ['red', 'black'],
        sortOrder: 2,
      },
    ],
    is_frozen: false,
    published_at: '2026-07-01T00:00:00.000Z',
    published_by_user_id: null,
  };

  it('restores the snapshot definition and reinserts its entries onto the parent', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
      penalty_ruleset_versions: { maybeSingle: SNAPSHOT },
      tournaments: { count: 0 },
      events: { count: 0 },
    });

    await service.rollbackRuleset('pr-1', 'ver-1', 'user-1');

    expect(supabase.updated.penalty_rulesets?.[0]).toMatchObject({
      name: 'Older name',
      accumulation_scope: 'tournament',
      yellow_card_points: -1,
      red_card_points: -2,
      second_black_card_forfeit: 'none',
    });
    expect(supabase.deleted).toContain('penalty_ruleset_entries');
    const rows = supabase.inserted.penalty_ruleset_entries?.[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ref_number: 'X1', group_number: 2, sanctions: ['yellow'] });
    expect(rows[1]).toMatchObject({ ref_number: 'X2', sanctions: ['red', 'black'], sort_order: 2 });
  });

  it('refuses to roll back a ruleset pinned by a tournament', async () => {
    const { service, supabase } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
      penalty_ruleset_versions: { maybeSingle: SNAPSHOT },
      tournaments: { count: 1 },
      events: { count: 0 },
    });

    await expect(service.rollbackRuleset('pr-1', 'ver-1', 'user-1')).rejects.toThrow(
      /in use by a tournament or event/i,
    );
    expect(supabase.updated.penalty_rulesets).toBeUndefined();
  });

  it('refuses to roll back the built-in ruleset', async () => {
    const { service } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture({ built_in: true }) },
    });
    await expect(service.rollbackRuleset('pr-1', 'ver-1', 'user-1')).rejects.toThrow(
      /cannot be rolled back/i,
    );
  });

  it('404s when the version does not belong to the ruleset', async () => {
    const { service } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
      penalty_ruleset_versions: { maybeSingle: null },
      tournaments: { count: 0 },
      events: { count: 0 },
    });
    await expect(service.rollbackRuleset('pr-1', 'missing', 'user-1')).rejects.toThrow(
      /not found/i,
    );
  });

  it('lists versions most recent first', async () => {
    const versions = [
      { id: 'v2', version: '1.0.1', published_at: '2026-07-02' },
      { id: 'v1', version: '1.0.0', published_at: '2026-07-01' },
    ];
    const { service } = makeService({
      penalty_rulesets: { maybeSingle: rulesetFixture() },
      penalty_ruleset_versions: { select: versions },
    });
    const result = await service.listVersions('pr-1', 'user-1');
    expect(result).toEqual(versions);
  });
});

describe('bumpPenaltyVersion', () => {
  it('increments the numeric tail', () => {
    expect(bumpPenaltyVersion('1.0.0')).toBe('1.0.1');
    expect(bumpPenaltyVersion('2')).toBe('3');
    expect(bumpPenaltyVersion('1.4')).toBe('1.5');
  });

  it('suffixes .1 for a non-numeric tail and defaults an empty string', () => {
    expect(bumpPenaltyVersion('2026-final')).toBe('2026-final.1');
    expect(bumpPenaltyVersion('')).toBe('1.0.1');
  });
});
