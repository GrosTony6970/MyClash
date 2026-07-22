import { describe, expect, it } from 'vitest';
import { isCodedRuleset, rulesetFormInitial } from './ruleset-form-initial';

const TF_MATCH_FORMAT = {
  pointCap: 10,
  timerMode: 'countdown' as const,
  timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
  softClockLimitSeconds: 5,
  maxDoubleHits: 4,
};

describe('rulesetFormInitial', () => {
  it('hydrates TF v1 match-format defaults from tf_config (the org-view bug case)', () => {
    const { matchFormatDefaults } = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { matchFormat: TF_MATCH_FORMAT },
    });

    expect(matchFormatDefaults.pointCap).toBe(10);
    expect(matchFormatDefaults.timeLimitsSeconds).toEqual({ pool: 90, bracket: 90, finals: 90 });
    expect(matchFormatDefaults.softClockLimitSeconds).toBe(5);
  });

  it('deep-merges a partial tf_config timeLimitsSeconds over the schema defaults', () => {
    const { matchFormatDefaults } = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { matchFormat: { timeLimitsSeconds: { pool: 120 } as never } },
    });

    expect(matchFormatDefaults.timeLimitsSeconds.pool).toBe(120);
    expect(matchFormatDefaults.timeLimitsSeconds.bracket).toBe(180);
  });

  it('falls back to schema defaults + default internals for TF v1 with no tf_config', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: null,
    });

    expect(out.matchFormatDefaults.pointCap).toBe(5);
    expect(out.tfV1Internals).toEqual({ winBonus: 3, deepTarget: 2, shallowTarget: 1 });
    // null, not '': the double-penalty is a spec (key | AST | null), and
    // "no penalty" is null rather than an empty string.
    expect(out.doublePenaltyFormula).toBe(null);
  });

  it('reads the flat columns for custom rulesets and ignores any tf_config', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: { pointCap: 7 },
      double_penalty_formula: 'n*(n-1)/3',
      tf_config: { matchFormat: TF_MATCH_FORMAT },
    });

    expect(out.matchFormatDefaults.pointCap).toBe(7);
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/3');
  });

  it('extracts TF v1 internals + double-penalty formula from tf_config', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: {
        winBonus: 4,
        targetValues: { deepTarget: 3, shallowTarget: 2 },
        doublePenaltyFormula: 'n*(n-1)/3',
      },
    });

    expect(out.tfV1Internals).toEqual({ winBonus: 4, deepTarget: 3, shallowTarget: 2 });
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/3');
  });

  it('hydrates a base_code fork from tf_config like TF v1 (not the flat columns)', () => {
    const out = rulesetFormInitial({
      code: 'custom_tf_v1_fork_abc',
      base_code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: {
        winBonus: 5,
        targetValues: { deepTarget: 3, shallowTarget: 2 },
        matchFormat: TF_MATCH_FORMAT,
        doublePenaltyFormula: 'n*(n-1)/3',
      },
    });

    expect(out.tfV1Internals).toEqual({ winBonus: 5, deepTarget: 3, shallowTarget: 2 });
    expect(out.matchFormatDefaults.pointCap).toBe(10);
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/3');
  });
});

describe('isCodedRuleset', () => {
  it('is true for TF_v1 and for a base_code fork of it', () => {
    expect(isCodedRuleset('TF_v1')).toBe(true);
    expect(isCodedRuleset('custom_tf_v1_fork_x', 'TF_v1')).toBe(true);
  });

  it('is false for an authored formula ruleset', () => {
    expect(isCodedRuleset('my_formula')).toBe(false);
    expect(isCodedRuleset('my_formula', null)).toBe(false);
  });
});

describe('rulesetFormInitial — targets hydration', () => {
  it('reads a custom ruleset targets column', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: null,
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Limb', value: 1 },
      ],
      tf_config: null,
    });
    expect(out.targets).toEqual([
      { name: 'Head', value: 3 },
      { name: 'Limb', value: 1 },
    ]);
  });

  it('derives TF v1 targets from the legacy tf_config.targetValues pair', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { targetValues: { deepTarget: 4, shallowTarget: 2 } },
    });
    expect(out.targets).toEqual([
      { name: 'Deep', value: 4 },
      { name: 'Shallow', value: 2 },
    ]);
  });

  it('prefers an explicit tf_config.targets list over the legacy pair', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: {
        targets: [{ name: 'Only', value: 5 }],
        targetValues: { deepTarget: 4, shallowTarget: 2 },
      },
    });
    expect(out.targets).toEqual([{ name: 'Only', value: 5 }]);
  });

  it('falls back to the federal default when nothing is stored', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: null,
      targets: null,
      tf_config: null,
    });
    expect(out.targets).toEqual([
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ]);
  });
});

describe('rulesetFormInitial — afterblow hydration', () => {
  it('reads a custom ruleset afterblow grammar', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: null,
      targets: [{ name: 'Hit', value: 1 }],
      has_afterblow: true,
      afterblow_mode: 'deductive',
      afterblow_valuation: 'weighted',
      afterblow_fixed_value: null,
      tf_config: null,
    });
    expect(out.afterblow).toEqual({
      hasAfterblow: true,
      afterblowValuation: 'weighted',
      afterblowFixedValue: 1,
      afterblowMode: 'deductive',
    });
  });

  it('shows TF v1 as using its federal afterblow even with null columns', () => {
    // TF_v1's grammar lives in code, so its mirror row's columns are null;
    // the form should still show afterblow-on rather than defaulting it off.
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: null,
    });
    expect(out.afterblow.hasAfterblow).toBe(true);
    expect(out.afterblow.afterblowValuation).toBe('fixed');
    // FFAMHE is deductive; TF_v1's mode lives in code, so the mirror row is
    // null and hydration must supply the real value, not the generic 'full'.
    expect(out.afterblow.afterblowMode).toBe('deductive');
  });

  it('defaults a custom ruleset with no afterblow columns to off', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: null,
      targets: [{ name: 'Hit', value: 1 }],
      tf_config: null,
    });
    expect(out.afterblow.hasAfterblow).toBe(false);
  });
});

describe('rulesetFormInitial — double-penalty spec hydration', () => {
  it('reads a custom ruleset key spec', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: 'n*(n-1)/2',
      tf_config: null,
    });
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/2');
  });

  it('reads a custom ruleset authored AST spec', () => {
    const ast = { type: 'var' as const, name: 'doubleHits' as const };
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: null,
      double_penalty_formula: ast,
      tf_config: null,
    });
    expect(out.doublePenaltyFormula).toEqual(ast);
  });

  it('reads TF v1 double-penalty from tf_config', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { doublePenaltyFormula: 'n*(n-1)/3' },
    });
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/3');
  });
});
