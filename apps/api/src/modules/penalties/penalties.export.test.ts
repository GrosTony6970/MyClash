import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';
import { buildRulesetExport } from '../../common/ruleset-export';

// getRuleset reads one penalty_rulesets row (with its entries) by id.
function serviceWithRow(row: Record<string, unknown> | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const fromMock = vi.fn().mockReturnValue(chain);
  const svc = new PenaltiesService({ service: { from: fromMock } } as never);
  // Bypass the org-membership gate — auth is exercised elsewhere.
  vi.spyOn(
    svc as unknown as { assertUserCanManageOrg: () => Promise<void> },
    'assertUserCanManageOrg',
  ).mockResolvedValue(undefined);
  return svc;
}

const penaltyRow = {
  id: 'p1',
  name: 'House penalties',
  version: '1.0.0',
  description: null,
  accumulation_scope: 'tournament',
  built_in: false,
  owner_organization_id: 'org-1',
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  penalty_ruleset_entries: [
    { group_number: 2, ref_number: 'B1', short_name: 'x', description: '', sanctions: ['red'] },
    { group_number: 1, ref_number: 'A1', short_name: 'y', description: '', sanctions: ['yellow'] },
  ],
};

describe('PenaltiesService — portable export/import', () => {
  it('exports a penalty ruleset with entries sorted by (group, ref) for a stable hash', async () => {
    const svc = serviceWithRow(penaltyRow);
    const env = await svc.exportRulesetJson('p1', 'actor-1');
    expect(env.type).toBe('penalty');
    const def = env.definition as { entries: Array<{ groupNumber: number; refNumber: string }> };
    expect(def.entries.map((e) => `${e.groupNumber}:${e.refNumber}`)).toEqual(['1:A1', '2:B1']);
  });

  it('refuses to export a built-in penalty ruleset', async () => {
    const svc = serviceWithRow({ ...penaltyRow, built_in: true });
    await expect(svc.exportRulesetJson('p1', 'actor-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('imports a penalty envelope through createRuleset with a fresh code', async () => {
    const svc = new PenaltiesService({ service: { from: vi.fn() } } as never);
    const spy = vi.spyOn(svc, 'createRuleset').mockResolvedValue({ id: 'new' } as never);
    const env = buildRulesetExport('penalty', {
      name: 'Imported Penalties',
      version: '3.0.0',
      accumulationScope: 'match',
      entries: [
        { groupNumber: 1, refNumber: 'A1', shortName: 'x', description: '', sanctions: ['yellow'] },
      ],
    });
    await svc.importRulesetJson('org-1', env, 'actor-1');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerOrganizationId: 'org-1',
        name: 'Imported Penalties',
        version: '3.0.0',
        publicVisibility: false,
        code: expect.stringContaining('imported-'),
      }),
      'actor-1',
    );
  });

  it('refuses to import a scoring envelope as a penalty ruleset', async () => {
    const svc = new PenaltiesService({ service: { from: vi.fn() } } as never);
    const env = buildRulesetExport('scoring', { name: 'X', version: '1.0.0', scoreFormula: {} });
    await expect(svc.importRulesetJson('org-1', env, 'actor-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
