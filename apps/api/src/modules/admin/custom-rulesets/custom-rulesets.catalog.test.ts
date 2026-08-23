import { describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
import { createRulesetRegistry } from '../../rulesets/ruleset-registry';

// A thenable chain that supports `.or().order().order()` (the catalog query
// shape), `.select().in()` (org-name + base-name resolution) and
// `.select().eq().maybeSingle()` (the base's stored overrides, read while
// computing lineage), keyed by table.
function catalogSupabase(byTable: Record<string, unknown[]>) {
  return {
    service: {
      from: vi.fn((table: string) => {
        const rows = byTable[table] ?? [];
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'or', 'order', 'in', 'eq', 'neq', 'is']) {
          chain[m] = vi.fn(() => chain);
        }
        chain['maybeSingle'] = vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }));
        chain['then'] = (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null });
        return chain;
      }),
    },
  };
}

/** The TF v1 row as seeded: `tf_config` holds only super-admin overrides (none
 *  here), so the lineage projection must fill the rest from the static defaults
 *  rather than reading this column as the base's whole behaviour. */
function builtInTfV1() {
  return {
    id: 'sys-1',
    code: 'TF_v1',
    version: '1.0.0',
    name: 'TF v1',
    description: null,
    is_system: true,
    base_code: null,
    base_version: null,
    tf_config: null,
    match_format_defaults: null,
    double_penalty_formula: null,
    owner_organization_id: null,
    public_visibility: false,
    targets: null,
    has_afterblow: true,
    afterblow_mode: 'deductive',
    afterblow_valuation: 'fixed',
    afterblow_fixed_value: 1,
  };
}

describe('CustomRulesetsService.listCatalogForOrg', () => {
  it('returns built-ins + other orgs’ public rows, attributed by org name, own excluded', async () => {
    const supabase = catalogSupabase({
      custom_rulesets: [
        {
          id: 'sys-1',
          code: 'TF_v1',
          version: '1.0.0',
          name: 'TF v1',
          description: null,
          is_system: true,
          base_code: null,
          owner_organization_id: null,
          public_visibility: false,
          targets: null,
          has_afterblow: true,
        },
        {
          id: 'shared-1',
          code: 'ORGX_RULES',
          version: '1.0.0',
          name: 'Org X Rules',
          description: 'shared',
          is_system: false,
          base_code: 'TF_v1',
          owner_organization_id: 'org-x',
          public_visibility: true,
          targets: [{ name: 'head', value: 2 }],
          has_afterblow: false,
        },
      ],
      organizations: [{ id: 'org-x', name: 'Org X' }],
    });
    const svc = new CustomRulesetsService(supabase as never, createRulesetRegistry());

    const result = await svc.listCatalogForOrg('org-me');

    expect(result).toHaveLength(2);
    // Built-in: no owning org.
    expect(result[0]).toMatchObject({
      id: 'sys-1',
      is_system: true,
      owner_organization_name: null,
    });
    // Shared row attributed by NAME, not the raw UUID.
    expect(result[1]).toMatchObject({
      id: 'shared-1',
      base_code: 'TF_v1',
      owner_organization_name: 'Org X',
    });
    // The visibility filter excludes the caller's own rows.
    const orClause = (
      supabase.service.from.mock.results[0]?.value as { or: ReturnType<typeof vi.fn> }
    ).or;
    expect(orClause).toHaveBeenCalledWith(
      expect.stringContaining('owner_organization_id.neq.org-me'),
    );
  });

  it('carries server-computed lineage for a fork, and none for what reuses nothing', async () => {
    // A card must not have to derive this: only the server can project the
    // base's EFFECTIVE behaviour (its stored tf_config is overrides-only).
    const supabase = catalogSupabase({
      custom_rulesets: [
        builtInTfV1(),
        {
          id: 'shared-1',
          code: 'ORGX_RULES',
          version: '1.0.0',
          name: 'Org X Rules',
          description: 'shared',
          is_system: false,
          base_code: 'TF_v1',
          base_version: '1.0.0',
          tf_config: null,
          match_format_defaults: null,
          double_penalty_formula: null,
          owner_organization_id: 'org-x',
          public_visibility: true,
          // Same engine, different grammar: one target, no afterblow.
          targets: [{ name: 'head', value: 2 }],
          has_afterblow: false,
          afterblow_mode: null,
          afterblow_valuation: null,
          afterblow_fixed_value: null,
        },
      ],
      organizations: [{ id: 'org-x', name: 'Org X' }],
    });
    const svc = new CustomRulesetsService(supabase as never, createRulesetRegistry());

    const result = await svc.listCatalogForOrg('org-me');

    // The built-in reuses nothing.
    expect(result[0]?.lineage).toBeNull();
    // The fork changed only its grammar — so ranking stays compatible and the
    // "placings no longer match" guardrail must NOT fire.
    expect(result[1]?.lineage).toEqual({
      base: 'TF v1',
      diff: {
        grammar: 'changed',
        endConditions: 'unchanged',
        ranking: 'unchanged',
        rankingCompatible: true,
      },
    });
  });

  it('skips the org-name lookup when only built-ins are adoptable', async () => {
    const supabase = catalogSupabase({
      custom_rulesets: [
        {
          id: 'sys-1',
          code: 'TF_v1',
          version: '1.0.0',
          name: 'TF v1',
          description: null,
          is_system: true,
          base_code: null,
          owner_organization_id: null,
          public_visibility: false,
          targets: null,
          has_afterblow: true,
        },
      ],
    });
    const svc = new CustomRulesetsService(supabase as never, createRulesetRegistry());

    const result = await svc.listCatalogForOrg('org-me');

    expect(result).toHaveLength(1);
    // Only custom_rulesets is queried — organizations is never touched.
    expect(supabase.service.from).toHaveBeenCalledTimes(1);
    expect(supabase.service.from).toHaveBeenCalledWith('custom_rulesets');
  });
});
