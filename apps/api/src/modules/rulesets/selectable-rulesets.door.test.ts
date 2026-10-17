/**
 * The doors' check (`isSelectable`): a Tournament may be pointed at a club pair
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

describe('SelectableRulesetsService.isSelectable', () => {
  it("asks for that pair in the organization's own scope, as the picker lists it", async () => {
    const { service, chain, resolve, from } = harness(ROW);

    expect(await service.isSelectable('org-1', 'custom_house', '1.0.0')).toBe(true);
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

  it('refuses a pair the scope does not hold: another club’s private ruleset', async () => {
    const { service, resolve } = harness({ data: [], error: null });
    expect(await service.isSelectable('org-1', 'custom_theirs', '1.0.0')).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a pair in scope that does not resolve', async () => {
    const { service } = harness(ROW, null);
    expect(await service.isSelectable('org-1', 'custom_house', '1.0.0')).toBe(false);
  });

  it('adds the platform drafts for the super-admin, as the picker does', async () => {
    const { service, chain } = harness(ROW);
    await service.isSelectable('org-1', 'custom_draft', '1.0.0', { withDrafts: true });
    expect(chain.or).toHaveBeenCalledWith(
      'and(status.neq.draft,or(is_system.eq.true,public_visibility.eq.true,owner_organization_id.eq.org-1)),' +
        'and(status.eq.draft,owner_organization_id.is.null)',
    );
    expect(chain.neq).not.toHaveBeenCalledWith('status', 'draft');
  });

  it('throws on a read that fails: a door must not answer it "does not exist"', async () => {
    const { service } = harness({ data: null, error: { message: 'db down' } });
    await expect(service.isSelectable('org-1', 'custom_house', '1.0.0')).rejects.toThrow('db down');
  });

  it('lets a failed resolve through as the failure it is', async () => {
    const { service, resolve } = harness(ROW);
    resolve.mockRejectedValue(new Error('connection reset'));
    await expect(service.isSelectable('org-1', 'custom_house', '1.0.0')).rejects.toThrow(
      'connection reset',
    );
  });
});
