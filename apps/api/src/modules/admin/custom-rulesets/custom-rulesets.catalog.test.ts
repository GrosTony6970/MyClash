import { describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';

// A thenable chain that supports `.or().order().order()` (the catalog query
// shape) and `.select().in()` (org-name resolution), keyed by table.
function catalogSupabase(byTable: Record<string, unknown[]>) {
  return {
    service: {
      from: vi.fn((table: string) => {
        const rows = byTable[table] ?? [];
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'or', 'order', 'in', 'eq', 'neq', 'is']) {
          chain[m] = vi.fn(() => chain);
        }
        chain['then'] = (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null });
        return chain;
      }),
    },
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
    const svc = new CustomRulesetsService(supabase as never);

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
    const svc = new CustomRulesetsService(supabase as never);

    const result = await svc.listCatalogForOrg('org-me');

    expect(result).toHaveLength(1);
    // Only custom_rulesets is queried — organizations is never touched.
    expect(supabase.service.from).toHaveBeenCalledTimes(1);
    expect(supabase.service.from).toHaveBeenCalledWith('custom_rulesets');
  });
});
