import { describe, expect, it } from 'vitest';
import { isCodedRuleset, rulesetFormInitial } from './ruleset-form-initial';

/** A stored match format no engine default holds (cap 7), with a key the box does not show. */
const TF_MATCH_FORMAT = {
  pointCap: 7,
  timerMode: 'countdown' as const,
  timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
  softClockLimitSeconds: 5,
  maxDoubleHits: 4,
  bestOf: { pool: 3 },
};

/**
 * The form starts from the ruleset's OWN values, exactly as stored (operator ruling 59): no default
 * is filled in, so an untouched field stays empty and follows the engine. What the box shows for an
 * empty field is `ruleset-own-values`' business.
 */
describe('rulesetFormInitial', () => {
  it('hydrates TF v1 match format from tf_config, as stored (the org-view bug case)', () => {
    const { ownMatchFormat } = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { matchFormat: TF_MATCH_FORMAT },
    });

    expect(ownMatchFormat).toEqual(TF_MATCH_FORMAT);
  });

  it('keeps a partial stored match format partial (no 180 filled in)', () => {
    const { ownMatchFormat } = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { matchFormat: { timeLimitsSeconds: { pool: 120 } } },
    });

    expect(ownMatchFormat).toEqual({ timeLimitsSeconds: { pool: 120 } });
  });

  it('has no own values for TF v1 with no tf_config', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: null,
    });

    expect(out.ownMatchFormat).toEqual({});
    expect(out.ownCoded).toEqual({});
    // null, not '': the double-penalty is a spec (key | AST | null), and
    // "no penalty" is null rather than an empty string.
    expect(out.doublePenaltyFormula).toBe(null);
  });

  it('reads the flat columns for custom rulesets and ignores any tf_config', () => {
    const out = rulesetFormInitial({
      code: 'my_custom',
      match_format_defaults: { pointCap: 7 },
      double_penalty_formula: 'n*(n-1)/3',
      tf_config: { matchFormat: { pointCap: 12 }, winBonus: 4 },
    });

    expect(out.ownMatchFormat).toEqual({ pointCap: 7 });
    expect(out.ownCoded).toEqual({});
    expect(out.doublePenaltyFormula).toBe('n*(n-1)/3');
  });

  it('takes the TF v1 dials present in tf_config as its own, and only those', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { winBonus: 4, doublePenaltyFormula: 'n*(n-1)/2' },
    });
    const winBonusOnly = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { winBonus: 4 },
    });

    expect(out.ownCoded).toEqual({ winBonus: 4, doublePenaltyFormula: 'n*(n-1)/2' });
    expect(winBonusOnly.ownCoded).toEqual({ winBonus: 4 });
  });

  it('hydrates a base_code fork from tf_config like TF v1 (not the flat columns)', () => {
    const out = rulesetFormInitial({
      code: 'custom_tf_v1_fork_abc',
      base_code: 'TF_v1',
      match_format_defaults: { pointCap: 12 },
      double_penalty_formula: null,
      tf_config: { winBonus: 5, matchFormat: TF_MATCH_FORMAT },
    });

    expect(out.ownCoded).toEqual({ winBonus: 5 });
    expect(out.ownMatchFormat).toEqual(TF_MATCH_FORMAT);
  });

  it('reads the flat columns when a fork row lost its base_code', () => {
    // The clone/adopt page used to strip base_code from its local row shape, so a fork row
    // hydrated as a formula ruleset and read its (null) flat columns: the fork's own values were
    // lost. Pinned so that regression stays legible.
    const forkRow = {
      code: 'custom_tf_v1_fork_abc',
      base_code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { winBonus: 5, matchFormat: TF_MATCH_FORMAT },
    };

    const withoutBase = rulesetFormInitial({ ...forkRow, base_code: null });

    expect(rulesetFormInitial(forkRow).ownMatchFormat).toEqual(TF_MATCH_FORMAT);
    expect(withoutBase.ownMatchFormat).toEqual({});
    expect(withoutBase.ownCoded).toEqual({});
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

  it('shows the engine’s targets on TF v1 when only the legacy pair is stored', () => {
    // The engine reads `targets`, which its own defaults always hold, so a stored
    // targetValues pair alone is never played (tf_v1/targets.ts withDerivedTargets).
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      tf_config: { targetValues: { deepTarget: 4, shallowTarget: 2 } },
    });
    expect(out.targets).toEqual([
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ]);
  });

  it('reads TF v1 targets from tf_config, not the flat column the engine never plays', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: null,
      targets: [
        { name: 'Deep', value: 2 },
        { name: 'Shallow', value: 1 },
      ],
      tf_config: { targets: [{ name: 'Only', value: 5 }] },
    });
    expect(out.targets).toEqual([{ name: 'Only', value: 5 }]);
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

  it('reads TF v1 double-penalty from tf_config, as one of its dials', () => {
    const out = rulesetFormInitial({
      code: 'TF_v1',
      match_format_defaults: null,
      double_penalty_formula: 'n*(n-1)/2',
      tf_config: { doublePenaltyFormula: 'n*(n-1)/3' },
    });
    expect(out.ownCoded.doublePenaltyFormula).toBe('n*(n-1)/3');
    expect(out.doublePenaltyFormula).toBe(null);
  });
});
