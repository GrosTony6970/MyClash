import { describe, expect, it } from 'vitest';
import type { EffectiveRules, EffectiveTfRules } from '@myclash/types';
import { TF_FORM, tfForm } from './tf-form';

const TF: EffectiveTfRules = {
  winBonus: 5,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
};
const rulesWith = (tf: EffectiveTfRules | null) => ({ tf }) as EffectiveRules;

describe('tfForm', () => {
  it("shows TF_v1's settings in force, and no forfeit rule (rulings 63, 68)", () => {
    expect(tfForm(TF)).toEqual(TF);
  });
});

describe('TF_FORM', () => {
  it('sends the settings under rulesetConfig', () => {
    const form = TF_FORM.formOf(rulesWith(TF));
    expect(TF_FORM.bodyOf(form)).toEqual({ rulesetConfig: TF });
  });

  it('has nothing to show or send for a ruleset whose engine is not TF_v1', () => {
    const form = TF_FORM.formOf(rulesWith(null));
    expect(form).toEqual({ tf: null });
    expect(TF_FORM.bodyOf(form)).toEqual({});
  });
});
