import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';
import { freezePenaltyRulesetVersion } from './penalty-version.util';

// Thenable harness: bare `.select().eq()` / `.in().neq()` resolve via `then`
// (per-table `select` → data, `count` → count); `.single()`/`.maybeSingle()`
// resolve their own promises. Records inserts + updates.
type TableState = Record<string, { maybeSingle?: unknown; select?: unknown[]; count?: number }>;

function fakeSupabase(state: TableState) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};
  function chain(table: string) {
    const t = state[table] ?? {};
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      in: vi.fn(() => api),
      is: vi.fn(() => api),
      neq: vi.fn(() => api),
      maybeSingle: vi.fn(() => Promise.resolve({ data: t.maybeSingle ?? null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: t.maybeSingle ?? null, error: null })),
      insert: vi.fn((row: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), row];
        return api;
      }),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        return api;
      }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: t.select ?? [], count: t.count ?? 0, error: null }),
    };
    return api;
  }
  return { inserted, updated, service: { from: vi.fn((table: string) => chain(table)) } };
}

const ENTRIES = [
  {
    group_number: 1,
    ref_number: 'R1',
    short_name: 'a',
    description: 'd',
    sanctions: ['red'],
    sort_order: 1,
  },
  {
    group_number: 2,
    ref_number: 'R2',
    short_name: 'b',
    description: 'e',
    sanctions: ['yellow', 'black'],
    sort_order: 2,
  },
];

function penaltyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr-1',
    built_in: false,
    version: '1.0.0',
    name: 'Penalties',
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

describe('freezePenaltyRulesetVersion', () => {
  it('snapshots the current version with is_frozen=true', async () => {
    const supabase = fakeSupabase({ penalty_rulesets: { maybeSingle: penaltyRow() } });
    await freezePenaltyRulesetVersion(supabase as never, 'pr-1', 'user-1');
    const snap = supabase.inserted.penalty_ruleset_versions?.[0] as Record<string, unknown>;
    expect(snap).toMatchObject({
      penalty_ruleset_id: 'pr-1',
      version: '1.0.0',
      is_frozen: true,
      published_by_user_id: 'user-1',
    });
    expect(snap.entries).toHaveLength(2);
  });

  it('is a no-op for the built-in ruleset', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: penaltyRow({ built_in: true }) },
    });
    await freezePenaltyRulesetVersion(supabase as never, 'pr-1');
    expect(supabase.inserted.penalty_ruleset_versions).toBeUndefined();
  });

  it('is a no-op when the ruleset is missing', async () => {
    const supabase = fakeSupabase({ penalty_rulesets: { maybeSingle: null } });
    await freezePenaltyRulesetVersion(supabase as never, 'pr-x');
    expect(supabase.inserted.penalty_ruleset_versions).toBeUndefined();
  });
});

describe('PenaltiesService.assignTournamentRuleset — re-pin guard + freeze', () => {
  it('blocks changing the penalty ruleset once matches are scored', async () => {
    const supabase = fakeSupabase({
      tournaments: { maybeSingle: { event_id: 'ev-1', penalty_ruleset_id: 'pr-old' } },
      events: { maybeSingle: { organization_id: 'org-1' } },
      phases: { select: [{ id: 'ph-1' }] },
      matches: { count: 1 },
    });
    const service = new PenaltiesService(supabase as never);

    await expect(
      service.assignTournamentRuleset('t-1', { penaltyRulesetId: 'pr-new' } as never, 'user-1'),
    ).rejects.toThrow(/locked/i);
    expect(supabase.updated.tournaments).toBeUndefined();
  });

  it('assigns and freezes the newly-pinned ruleset when nothing is scored', async () => {
    const supabase = fakeSupabase({
      tournaments: { maybeSingle: { event_id: 'ev-1', penalty_ruleset_id: null } },
      events: { maybeSingle: { organization_id: 'org-1' } },
      phases: { select: [] },
      matches: { count: 0 },
      penalty_rulesets: { maybeSingle: penaltyRow() },
    });
    const service = new PenaltiesService(supabase as never);

    await service.assignTournamentRuleset('t-1', { penaltyRulesetId: 'pr-1' } as never, 'user-1');

    expect(supabase.updated.tournaments?.[0]).toMatchObject({ penalty_ruleset_id: 'pr-1' });
    expect(supabase.inserted.penalty_ruleset_versions?.[0]).toMatchObject({
      penalty_ruleset_id: 'pr-1',
      is_frozen: true,
    });
  });
});
