import { describe, expect, it, vi } from 'vitest';
import { resolveRulesetConfigDefaults } from './ruleset-defaults';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/**
 * A ruleset's default settings are read or refused: a failed read throws, never a `{}` or the
 * static defaults written as the ruleset's (the audited settings change, revision 5 correction 3).
 */
const failing = () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }),
  });
  return { service: { from: vi.fn(() => chain) } };
};

describe("a ruleset's default settings fail closed", () => {
  it("throws when a club ruleset's settings cannot be read", async () => {
    await expect(
      resolveRulesetConfigDefaults(failing() as never, 'club_x', '1.0.0'),
    ).rejects.toThrow('The settings of ruleset club_x@1.0.0 were not read: connection reset');
  });

  it("throws when a built-in's platform overrides cannot be read", async () => {
    await expect(
      resolveRulesetConfigDefaults(failing() as never, 'TF_v1', '1.0.0'),
    ).rejects.toThrow('The overrides of ruleset TF_v1 were not read: connection reset');
  });

  it("throws when a club formula's version snapshot cannot be read", async () => {
    const db = mockSupabase({
      custom_rulesets: { rows: [{ ...PARENT }] },
      custom_ruleset_versions: { data: null, error: { message: 'connection reset' } },
    });
    await expect(resolveRulesetConfigDefaults(db as never, 'club_x', '1.0.0')).rejects.toThrow(
      'The settings of ruleset club_x@1.0.0 were not read: connection reset',
    );
  });
});

/** A club formula whose parent row holds its draft: a cap of 13. */
const PARENT = {
  id: 'cr-x',
  code: 'club_x',
  base_code: null,
  base_version: null,
  tf_config: null,
  match_format_defaults: { pointCap: 13 },
  double_penalty_formula: null,
};

describe("a club formula's default settings are those of the version asked (ruling 51)", () => {
  const snapshot = (version: string, pointCap: number) => ({
    custom_ruleset_id: 'cr-x',
    version,
    match_format_defaults: { pointCap },
    double_penalty_formula: 'n*(n-1)/3',
  });

  it("reads that version's snapshot", async () => {
    const db = mockSupabase({
      custom_rulesets: { rows: [PARENT] },
      custom_ruleset_versions: { rows: [snapshot('1.0.0', 11), snapshot('1.0.1', 12)] },
    });
    expect(await resolveRulesetConfigDefaults(db as never, 'club_x', '1.0.0')).toEqual({
      matchFormat: { pointCap: 11 },
      doublePenaltyFormula: 'n*(n-1)/3',
    });
    // The parent's id keys the snapshot read: without it Postgres refuses `eq.undefined`.
    expect(selectsFor(db.from, 'custom_rulesets')).toEqual([
      'id, match_format_defaults, double_penalty_formula, base_code, base_version, tf_config',
    ]);
    expect(selectsFor(db.from, 'custom_ruleset_versions')).toEqual([
      'match_format_defaults, double_penalty_formula',
    ]);
    expect(filtersFor(db.from, 'custom_ruleset_versions', 'eq')).toEqual([
      ['custom_ruleset_id', 'cr-x'],
      ['version', '1.0.0'],
    ]);
  });

  it('reads the parent row of a version with no snapshot: a draft', async () => {
    const db = mockSupabase({
      custom_rulesets: { rows: [PARENT] },
      custom_ruleset_versions: { rows: [snapshot('1.0.0', 11)] },
    });
    expect(await resolveRulesetConfigDefaults(db as never, 'club_x', '1.0.1')).toEqual({
      matchFormat: { pointCap: 13 },
    });
  });

  it('reads a coded fork from its own row: it has no settings snapshot', async () => {
    const fork = {
      ...PARENT,
      base_code: 'TF_v1',
      base_version: '1.0.0',
      tf_config: { winBonus: 5 },
    };
    const db = mockSupabase({ custom_rulesets: { rows: [fork] } });
    expect(await resolveRulesetConfigDefaults(db as never, 'club_x', '1.0.0')).toMatchObject({
      winBonus: 5,
    });
  });
});
