/**
 * A club formula ruleset is decided by the end decision it was published with
 * (migration 0228, rulings "Club formulas" and "Edition day", 2026-10-17), on
 * both resolution paths: a bout fought before the shared decision moves and
 * corrected after it is decided as it was fought. That both paths SELECT the
 * column is pinned in ruleset-resolver.service.test.ts ("asks BOTH resolution
 * paths for the same grammar columns").
 */
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { CONSTANTS, FORMULA, makeResolver } from './ruleset-resolver.fixtures';

const formulaRow = (decisionEdition: unknown) => ({
  code: 'custom_house',
  version: '1.0.0',
  name: 'House rules',
  status: 'published',
  is_system: false,
  score_formula: FORMULA,
  constants: CONSTANTS,
  tiebreakers: [],
  targets: null,
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
  decision_edition: decisionEdition,
});

describe('RulesetResolver — the end decision a formula was published with', () => {
  it('a club row published before the shared decision moved keeps its edition', async () => {
    const { resolver } = makeResolver({ row: formulaRow('2026-04') });
    expect((await resolver.resolve('custom_house', '1.0.0'))?.decisionEdition).toBe('2026-04');
  });

  it('a published snapshot keeps the edition it was published with', async () => {
    const { resolver } = makeResolver({
      parent: { id: 'p1', name: 'House rules', is_system: false },
      snapshot: formulaRow('2026-04'),
    });
    expect((await resolver.resolve('custom_house', '1.0.0'))?.decisionEdition).toBe('2026-04');
  });

  it.each([null, '2027-01'])(
    'decides a stored edition it does not know (%s) by today’s rule, and says so',
    async (stored) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { resolver } = makeResolver({ row: formulaRow(stored) });
      expect((await resolver.resolve('custom_house', '1.0.0'))?.decisionEdition).toBe('2026-10');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('custom_house@1.0.0'));
      warn.mockRestore();
    },
  );
});
