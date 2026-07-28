/**
 * Lineage lamps must agree with the content-hash fingerprint about what a
 * "change" is. The way that guarantee was being broken had nothing to do with
 * the diff itself (packages/rulesets/src/lineage.ts is fine) and everything to
 * do with PROJECTION: a built-in's `tf_config` column holds only the
 * super-admin overrides — migration 0053 seeds TF_v1's without
 * `tournamentPolicy`, and Generic_PointsCap has no seed at all — while a coded
 * fork's `tf_config` is a tournament's fully-parsed `ruleset_config` and so
 * always carries every schema default.
 *
 * Comparing those two columns directly (what the web-admin edit page used to
 * do) reported `ranking: 'changed'` and fired the "placings no longer match
 * {base}" guardrail on a fork that scored IDENTICALLY to its base. The tests
 * below pin the fix: both sides are projected from effective behaviour.
 *
 * The mock dispatches by table name, not call order.
 */
import { describe, expect, it, vi } from 'vitest';
import { GenericPointsCapDefaultConfig, TFv1DefaultConfig } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';
import { describeForkLineage, type LineageRow } from './ruleset-lineage';

/** The grammar TF_v1 declares, as migration 0143 backfilled it onto the row. */
const TF_GRAMMAR = {
  targets: [
    { name: 'Deep target', value: 2 },
    { name: 'Shallow target', value: 1 },
  ],
  has_afterblow: true,
  afterblow_mode: 'deductive' as const,
  afterblow_valuation: 'fixed' as const,
  afterblow_fixed_value: 1,
};

/** A fork exactly as `buildCodedForkRow` writes it: the tournament's full
 *  parsed config as tf_config, the base's resolved grammar as columns. */
function forkRow(overrides: Partial<LineageRow> = {}): LineageRow {
  return {
    id: 'fork-1',
    code: 'custom_tf_v1_fork_abc',
    base_code: 'TF_v1',
    base_version: '1.0.0',
    tf_config: structuredClone(TFv1DefaultConfig) as unknown as Record<string, unknown>,
    match_format_defaults: null,
    double_penalty_formula: null,
    ...TF_GRAMMAR,
    ...overrides,
  };
}

/**
 * The built-in rows as they actually sit in the DB. TF_v1's `tf_config` is the
 * 0053 seed as realigned by 0072 — note the ABSENT `tournamentPolicy`, which is
 * the whole point: the resolver must fill it from the static defaults.
 */
const TF_V1_DB_ROW = {
  code: 'TF_v1',
  name: 'TF v1',
  is_system: true,
  tf_config: {
    winBonus: 3,
    targetValues: { deepTarget: 2, shallowTarget: 1 },
    matchFormat: {
      pointCap: 10,
      scoringDirection: 'normal',
      timerMode: 'countdown',
      timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
      softClockLimitSeconds: 5,
      maxDoubleHits: 4,
      maxDoubleHitOutcome: 'double_loss_zero_scores',
    },
    doublePenaltyFormula: 'n*(n-1)/3',
    forfeitPolicy: TFv1DefaultConfig.forfeitPolicy,
  },
  ...TF_GRAMMAR,
};

/** Generic_PointsCap never got a tf_config seed — its overrides column is null. */
const GENERIC_DB_ROW = {
  code: 'Generic_PointsCap',
  name: 'Generic points cap',
  is_system: true,
  tf_config: null,
  targets: [{ name: 'Hit', value: 1 }],
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
};

function fakeSupabase(builtIns: Array<Record<string, unknown>>): SupabaseService {
  const chain = () => {
    const c: Record<string, unknown> = {};
    let filterCode: string | null = null;
    Object.assign(c, {
      select: vi.fn(() => c),
      eq: vi.fn((column: string, value: string) => {
        if (column === 'code') filterCode = value;
        return c;
      }),
      in: vi.fn(() => Promise.resolve({ data: builtIns, error: null })),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: builtIns.find((row) => row['code'] === filterCode) ?? null,
          error: null,
        }),
      ),
    });
    return c;
  };
  return { service: { from: vi.fn(() => chain()) } } as unknown as SupabaseService;
}

describe('describeForkLineage', () => {
  it('lights NO lamp for a fresh fork that scores exactly like TF v1', async () => {
    // The regression: base tf_config lacks tournamentPolicy, fork's carries the
    // schema default. Projected from effective behaviour, they are the same.
    const lineage = await describeForkLineage(fakeSupabase([TF_V1_DB_ROW]), [forkRow()]);

    expect(lineage.get('fork-1')).toEqual({
      base: 'TF v1',
      diff: {
        grammar: 'unchanged',
        endConditions: 'unchanged',
        ranking: 'unchanged',
        rankingCompatible: true,
      },
    });
  });

  it('does not fire the ranking guardrail on a Generic_PointsCap fork either', async () => {
    // The harder case: the base row has NO tf_config at all, so every ranking
    // field would read null if the projection trusted the column.
    const fork = forkRow({
      base_code: 'Generic_PointsCap',
      tf_config: structuredClone(GenericPointsCapDefaultConfig) as unknown as Record<
        string,
        unknown
      >,
      targets: [{ name: 'Hit', value: 1 }],
      has_afterblow: false,
      afterblow_mode: null,
      afterblow_valuation: null,
      afterblow_fixed_value: null,
    });

    const lineage = await describeForkLineage(fakeSupabase([GENERIC_DB_ROW]), [fork]);

    expect(lineage.get('fork-1')?.diff.rankingCompatible).toBe(true);
    expect(lineage.get('fork-1')?.diff).toMatchObject({
      grammar: 'unchanged',
      endConditions: 'unchanged',
      ranking: 'unchanged',
    });
  });

  it('flags ranking + drops compatibility when the fork changes the win bonus', async () => {
    const fork = forkRow({
      tf_config: { ...structuredClone(TFv1DefaultConfig), winBonus: 5 } as unknown as Record<
        string,
        unknown
      >,
    });

    const diff = (await describeForkLineage(fakeSupabase([TF_V1_DB_ROW]), [fork])).get(
      'fork-1',
    )?.diff;

    expect(diff?.ranking).toBe('changed');
    expect(diff?.rankingCompatible).toBe(false);
    expect(diff?.grammar).toBe('unchanged');
  });

  it('flags grammar when a target value changes, without touching ranking', async () => {
    const fork = forkRow({
      targets: [
        { name: 'Deep target', value: 3 },
        { name: 'Shallow target', value: 1 },
      ],
    });

    const diff = (await describeForkLineage(fakeSupabase([TF_V1_DB_ROW]), [fork])).get(
      'fork-1',
    )?.diff;

    expect(diff?.grammar).toBe('changed');
    expect(diff?.ranking).toBe('unchanged');
    expect(diff?.rankingCompatible).toBe(true);
  });

  it('flags end conditions when the fork moves the point cap', async () => {
    const config = structuredClone(TFv1DefaultConfig) as unknown as Record<string, unknown>;
    (config['matchFormat'] as Record<string, unknown>)['pointCap'] = 15;

    const diff = (
      await describeForkLineage(fakeSupabase([TF_V1_DB_ROW]), [forkRow({ tf_config: config })])
    ).get('fork-1')?.diff;

    expect(diff?.endConditions).toBe('changed');
    expect(diff?.ranking).toBe('unchanged');
  });

  it('reports no lineage for a ruleset that reuses nothing', async () => {
    const standalone = forkRow({
      id: 'formula-1',
      code: 'custom_house_rules',
      base_code: null,
      base_version: null,
      tf_config: null,
    });

    const lineage = await describeForkLineage(fakeSupabase([TF_V1_DB_ROW]), [standalone]);

    expect(lineage.get('formula-1')).toBeNull();
  });

  it('names the base once for many forks of it', async () => {
    const supabase = fakeSupabase([TF_V1_DB_ROW]);
    const rows = [forkRow(), forkRow({ id: 'fork-2', code: 'custom_tf_v1_fork_def' })];

    const lineage = await describeForkLineage(supabase, rows);

    expect(lineage.get('fork-1')?.base).toBe('TF v1');
    expect(lineage.get('fork-2')?.base).toBe('TF v1');
    // A list read must not become an N+1: the base is resolved per distinct
    // base code, not per fork.
    const reads = (supabase.service.from as unknown as { mock: { calls: unknown[] } }).mock.calls;
    expect(reads.length).toBeLessThanOrEqual(3);
  });

  it('degrades to no lamps rather than throwing when the base is gone', async () => {
    const lineage = await describeForkLineage(fakeSupabase([]), [
      forkRow({ base_code: 'Deleted_Base' }),
    ]);

    expect(lineage.get('fork-1')).toBeNull();
  });
});
