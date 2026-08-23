/**
 * The picker's contract: everything it lists must actually resolve.
 *
 * The bug being fixed is that org-authored rulesets were invisible here —
 * `GET /rulesets` returned `registry.list()` and nothing registers a DB row —
 * so an org could author, publish and share a ruleset it could never select.
 */
import { describe, expect, it, vi } from 'vitest';
import { SelectableRulesetsService } from './selectable-rulesets.service';
import { createRulesetRegistry } from './ruleset-registry';

function makeSupabase(result: { data?: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  };
  return { supabase: { service: { from: vi.fn().mockReturnValue(chain) } }, chain };
}

function fakeRuleset(code: string, version = '1.0.0') {
  return {
    code,
    version,
    displayName: `Display ${code}`,
    rankingChain: [{ key: 'score', direction: 'desc' as const }],
    standingsColumns: [],
    metadata: { hasAfterblow: true },
  };
}

describe('SelectableRulesetsService', () => {
  it('always includes the coded built-ins', async () => {
    const { supabase } = makeSupabase({ data: [], error: null });
    const service = new SelectableRulesetsService(
      supabase as never,
      {
        resolve: vi.fn(),
      } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    expect(result.find((r) => r.code === 'TF_v1')).toBeDefined();
    expect(result.find((r) => r.code === 'Generic_PointsCap')).toBeDefined();
    expect(result.every((r) => r.custom === false)).toBe(true);
  });

  it('includes an org-authored ruleset that resolves, flagged as custom', async () => {
    const { supabase } = makeSupabase({
      data: [{ code: 'custom_house', version: '1.0.0' }],
      error: null,
    });
    const resolve = vi.fn().mockResolvedValue(fakeRuleset('custom_house'));
    const service = new SelectableRulesetsService(
      supabase as never,
      { resolve } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    const custom = result.find((r) => r.code === 'custom_house');
    expect(custom).toMatchObject({ code: 'custom_house', label: 'Display custom_house' });
    expect(custom?.custom).toBe(true);
  });

  it('drops a ruleset the resolver refuses', async () => {
    // Listing something unresolvable just moves the failure to standings-render
    // time, where it is a 400 on a page the organizer cannot debug.
    const { supabase } = makeSupabase({
      data: [{ code: 'custom_draft', version: '1.0.0' }],
      error: null,
    });
    const resolve = vi.fn().mockResolvedValue(null);
    const service = new SelectableRulesetsService(
      supabase as never,
      { resolve } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    expect(result.find((r) => r.code === 'custom_draft')).toBeUndefined();
  });

  it('drops a ruleset whose resolution throws, and keeps the rest', async () => {
    const { supabase } = makeSupabase({
      data: [
        { code: 'custom_broken', version: '1.0.0' },
        { code: 'custom_ok', version: '1.0.0' },
      ],
      error: null,
    });
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fakeRuleset('custom_ok'));
    const service = new SelectableRulesetsService(
      supabase as never,
      { resolve } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    expect(result.find((r) => r.code === 'custom_broken')).toBeUndefined();
    expect(result.find((r) => r.code === 'custom_ok')).toBeDefined();
  });

  it('excludes system mirror rows and scopes the query to the org', async () => {
    const { supabase, chain } = makeSupabase({ data: [], error: null });
    const service = new SelectableRulesetsService(
      supabase as never,
      {
        resolve: vi.fn(),
      } as never,
      createRulesetRegistry(),
    );

    await service.listForOrganization('org-1');
    // Built-ins come from the registry; the is_system mirrors carry empty
    // score_formula placeholders that mean nothing off the registry path.
    expect(chain.eq).toHaveBeenCalledWith('is_system', false);
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining('owner_organization_id.eq.org-1'),
    );
    // Archived rulesets still resolve (for tournaments pinned to them) but must
    // never be offered for a NEW tournament — delist ≠ delete.
    expect(chain.neq).toHaveBeenCalledWith('status', 'archived');
  });

  it('never lets a coded code be shadowed by a DB row of the same name', async () => {
    const { supabase } = makeSupabase({
      data: [{ code: 'TF_v1', version: '1.0.0' }],
      error: null,
    });
    const resolve = vi.fn();
    const service = new SelectableRulesetsService(
      supabase as never,
      { resolve } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    expect(result.filter((r) => r.code === 'TF_v1')).toHaveLength(1);
    expect(result.find((r) => r.code === 'TF_v1')?.custom).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('degrades to the built-ins when the catalog query fails', async () => {
    // A picker that 500s is worse than one showing only built-ins: the
    // organizer can still create the tournament they came to create.
    const { supabase } = makeSupabase({ data: null, error: { message: 'db down' } });
    const service = new SelectableRulesetsService(
      supabase as never,
      {
        resolve: vi.fn(),
      } as never,
      createRulesetRegistry(),
    );

    const result = await service.listForOrganization('org-1');
    expect(result.find((r) => r.code === 'TF_v1')).toBeDefined();
  });
});
