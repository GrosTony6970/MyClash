/**
 * The doors' check (`offeredVersion`): a Tournament may be pointed at a club pair
 * only as the picker offers it. Without it, an organiser who knew the code of
 * another club's private ruleset, or of a platform draft, could pin it, and so
 * freeze that club's ruleset (its edit guard counts the Tournaments on it).
 *
 * The mock ignores filters, so each case asserts the filters the read sends.
 */
import { describe, expect, it, vi } from 'vitest';
import { SelectableRulesetsService } from './selectable-rulesets.service';
import { createRulesetRegistry } from './ruleset-registry';

function harness(result: { data?: unknown; error?: unknown }, resolved: unknown = { code: 'x' }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  const resolve = vi.fn().mockResolvedValue(resolved);
  const from = vi.fn().mockReturnValue(chain);
  const service = new SelectableRulesetsService(
    { service: { from } } as never,
    { resolve } as never,
    createRulesetRegistry(),
  );
  return { service, chain, resolve, from };
}

const ROW = { data: [{ code: 'custom_house', version: '1.0.0' }], error: null };

describe('SelectableRulesetsService.offeredVersion', () => {
  it("asks for that pair in the organization's own scope, as the picker lists it", async () => {
    const { service, chain, resolve, from } = harness(ROW);

    expect(await service.offeredVersion('org-1', 'custom_house', '1.0.0')).toBe('1.0.0');
    expect(from.mock.calls).toEqual([['custom_rulesets']]);
    expect(chain.eq).toHaveBeenCalledWith('is_system', false);
    expect(chain.eq).toHaveBeenCalledWith('code', 'custom_house');
    expect(chain.eq).toHaveBeenCalledWith('version', '1.0.0');
    expect(chain.or).toHaveBeenCalledWith(
      'is_system.eq.true,public_visibility.eq.true,owner_organization_id.eq.org-1',
    );
    expect(chain.neq).toHaveBeenCalledWith('status', 'archived');
    expect(chain.neq).toHaveBeenCalledWith('status', 'draft');
    expect(resolve).toHaveBeenCalledWith('custom_house', '1.0.0');
  });

  it('gives the current version of a ruleset named with no version', async () => {
    // Club A published again: 1.0.0 became 1.0.1 (ruling "No version named").
    const { service, chain, resolve } = harness({
      data: [{ code: 'custom_house', version: '1.0.1' }],
      error: null,
    });
    expect(await service.offeredVersion('org-1', 'custom_house', undefined)).toBe('1.0.1');
    expect(chain.eq).not.toHaveBeenCalledWith('version', expect.anything());
    expect(resolve).toHaveBeenCalledWith('custom_house', '1.0.1');
  });

  it('refuses a pair the scope does not hold: another club’s private ruleset', async () => {
    const { service, resolve } = harness({ data: [], error: null });
    expect(await service.offeredVersion('org-1', 'custom_theirs', '1.0.0')).toBeNull();
    expect(await service.offeredVersion('org-1', 'custom_theirs', undefined)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a pair in scope that does not resolve', async () => {
    const { service } = harness(ROW, null);
    expect(await service.offeredVersion('org-1', 'custom_house', '1.0.0')).toBeNull();
  });

  it.each([
    ['super_admin', true],
    ['platform_admin', true],
    ['platform_viewer', false],
    [null, false],
  ])('offers the platform drafts to a %s: %s', async (role, offered) => {
    // platform_admin authors the drafts (ruling "Drafts for whom", 2026-10-18).
    const row = role ? { user_id: 'u1', role } : null;
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const from = vi.fn().mockReturnValue(chain);
    const service = new SelectableRulesetsService(
      { service: { from } } as never,
      { resolve: vi.fn() } as never,
      createRulesetRegistry(),
    );
    expect(await service.draftsOfferedTo('u1')).toBe(offered);
    // This user's own role, read from its table.
    expect(from).toHaveBeenCalledWith('platform_roles');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('adds the platform drafts when they are offered, as the picker does', async () => {
    const { service, chain } = harness(ROW);
    await service.offeredVersion('org-1', 'custom_draft', '1.0.0', { withDrafts: true });
    expect(chain.or).toHaveBeenCalledWith(
      'and(status.neq.draft,or(is_system.eq.true,public_visibility.eq.true,owner_organization_id.eq.org-1)),' +
        'and(status.eq.draft,owner_organization_id.is.null)',
    );
    expect(chain.neq).not.toHaveBeenCalledWith('status', 'draft');
  });

  it('throws on a read that fails: a door must not answer it "does not exist"', async () => {
    const { service } = harness({ data: null, error: { message: 'db down' } });
    await expect(service.offeredVersion('org-1', 'custom_house', '1.0.0')).rejects.toThrow(
      'db down',
    );
  });

  it('refuses to guess between two offered rows of one code: a server fault', async () => {
    const { service, chain, resolve } = harness({
      data: [
        { code: 'custom_house', version: '1.0.0' },
        { code: 'custom_house', version: '1.0.1' },
      ],
      error: null,
    });
    await expect(service.offeredVersion('org-1', 'custom_house', undefined)).rejects.toThrow(
      'Two rulesets custom_house are offered',
    );
    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('lets a failed resolve through as the failure it is', async () => {
    const { service, resolve } = harness(ROW);
    resolve.mockRejectedValue(new Error('connection reset'));
    await expect(service.offeredVersion('org-1', 'custom_house', '1.0.0')).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('SelectableRulesetsService.restorable', () => {
  it("keeps the club's own ruleset at an older version, whatever its status, if it resolves", async () => {
    // The row is at 1.0.1 now, archived or back in draft; the archive's
    // Tournament was pinned at 1.0.0.
    const { service, chain, resolve, from } = harness({
      data: [{ code: 'custom_house', version: '1.0.1' }],
      error: null,
    });
    expect(await service.restorable('org-1', 'custom_house', '1.0.0')).toBe(true);
    expect(from.mock.calls).toEqual([['custom_rulesets']]);
    expect(chain.eq).toHaveBeenCalledWith('is_system', false);
    expect(chain.eq).toHaveBeenCalledWith('code', 'custom_house');
    // Its own rows at any status; a shared one unless a draft; no platform draft.
    expect(chain.or.mock.calls).toEqual([
      ['owner_organization_id.eq.org-1,and(public_visibility.eq.true,status.neq.draft)'],
    ]);
    expect(chain.eq).not.toHaveBeenCalledWith('version', expect.anything());
    expect(chain.neq).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith('custom_house', '1.0.0');
  });

  it('adds the platform drafts when they are offered', async () => {
    const { service, chain } = harness(ROW);
    await service.restorable('org-1', 'custom_draft', '1.0.0', { withDrafts: true });
    expect(chain.or).toHaveBeenCalledWith(
      'owner_organization_id.eq.org-1,and(public_visibility.eq.true,status.neq.draft),' +
        'and(status.eq.draft,owner_organization_id.is.null)',
    );
  });

  it("refuses another club's private ruleset, and a version that no longer resolves", async () => {
    const theirs = harness({ data: [], error: null });
    expect(await theirs.service.restorable('org-1', 'custom_theirs', '1.0.0')).toBe(false);
    expect(theirs.resolve).not.toHaveBeenCalled();
    const gone = harness(ROW, null);
    expect(await gone.service.restorable('org-1', 'custom_house', '0.9.0')).toBe(false);
  });

  it('throws on a read that fails', async () => {
    const { service } = harness({ data: null, error: { message: 'db down' } });
    await expect(service.restorable('org-1', 'custom_house', '1.0.0')).rejects.toThrow('db down');
  });
});
