import { describe, expect, it } from 'vitest';
import { rulesetFormInitial } from './ruleset-form-initial';

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
    expect(out.doublePenaltyFormula).toBe('');
  });

  it('reads the flat columns for custom rulesets and ignores any tf_config', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: { pointCap: 7 },
      double_penalty_formula: 'n*2',
      tf_config: { matchFormat: TF_MATCH_FORMAT },
    });

    expect(out.matchFormatDefaults.pointCap).toBe(7);
    expect(out.doublePenaltyFormula).toBe('n*2');
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
});
