import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
import { buildRulesetExport } from '../../../common/ruleset-export';

// getById reads one custom_rulesets row via .select('*').eq('id').maybeSingle().
function serviceWithRow(row: Record<string, unknown> | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const fromMock = vi.fn().mockReturnValue(chain);
  return new CustomRulesetsService({ service: { from: fromMock } } as never);
}

const formulaRow = {
  id: 'r1',
  code: 'custom_x',
  version: '1.0.0',
  name: 'Cutlass',
  description: null,
  status: 'published',
  is_system: false,
  is_default: false,
  base_code: null,
  owner_organization_id: 'org-1',
  score_formula: { type: 'var', name: 'victories' },
  constants: { pointsPerVictory: 3 },
  tiebreakers: [],
  double_penalty_formula: null,
  match_format_defaults: null,
  targets: [{ name: 'Hit', value: 1 }],
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
};

describe('CustomRulesetsService — portable export/import', () => {
  it('exports an org-owned formula ruleset as a scoring envelope', async () => {
    const svc = serviceWithRow(formulaRow);
    const env = await svc.exportForOrg('r1', 'org-1');
    expect(env.type).toBe('scoring');
    expect(env.format).toBe('myclash.ruleset');
    expect((env.definition as { name: string }).name).toBe('Cutlass');
    expect((env.definition as { targets: unknown }).targets).toEqual([{ name: 'Hit', value: 1 }]);
    // No platform state leaks into the definition.
    expect(env.definition).not.toHaveProperty('owner_organization_id');
    expect(env.definition).not.toHaveProperty('status');
  });

  it('refuses to export a coded fork (reuses a built-in engine — not portable)', async () => {
    const svc = serviceWithRow({ ...formulaRow, base_code: 'TF_v1' });
    await expect(svc.exportForOrg('r1', 'org-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to export a ruleset the org does not own', async () => {
    const svc = serviceWithRow({ ...formulaRow, owner_organization_id: 'other-org' });
    await expect(svc.exportForOrg('r1', 'org-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('imports a scoring envelope through createForOrg (fresh row, re-validated)', async () => {
    const svc = serviceWithRow(formulaRow);
    const spy = vi.spyOn(svc, 'createForOrg').mockResolvedValue(formulaRow as never);
    const env = buildRulesetExport('scoring', {
      name: 'Imported',
      version: '2.0.0',
      scoreFormula: { type: 'var', name: 'victories' },
      constants: { pointsPerVictory: 3 },
      tiebreakers: [],
      targets: [{ name: 'Hit', value: 1 }],
    });
    await svc.importForOrg('org-1', env, 'actor-1');
    expect(spy).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ name: 'Imported', version: '2.0.0' }),
      'actor-1',
    );
  });

  it('refuses to import a penalty envelope as a scoring ruleset', async () => {
    const svc = serviceWithRow(formulaRow);
    const env = buildRulesetExport('penalty', {
      name: 'P',
      version: '1.0.0',
      accumulationScope: 'match',
      entries: [],
    });
    await expect(svc.importForOrg('org-1', env, 'actor-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
