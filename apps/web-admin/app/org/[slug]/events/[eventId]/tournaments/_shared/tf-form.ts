/**
 * The TF_v1 settings form (the Advanced tab and wizard Step 4): win bonus and target values, read
 * from the rules in force the API answers (`effectiveRules.tf`), never from a default of its own
 * (operator rulings 43, 46). No forfeit rule is here: the penalty ruleset owns them (ruling 68).
 */

import type { EffectiveTfRules } from '@myclash/types';
import type { RulesFormSpec } from './useEffectiveRules';

export interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
}

/** The form of TF_v1's settings in force, each field picked by name. */
export function tfForm(tf: EffectiveTfRules): RulesetConfigTF {
  return {
    winBonus: tf.winBonus,
    targetValues: {
      deepTarget: tf.targetValues.deepTarget,
      shallowTarget: tf.targetValues.shallowTarget,
    },
  };
}

/**
 * The Advanced form: TF_v1's settings, or null for a ruleset whose engine is not TF_v1's
 * (`effectiveRules.tf` is null): such a Tournament has none to show or send.
 */
export interface TfFormState {
  tf: RulesetConfigTF | null;
}

export const TF_FORM: RulesFormSpec<TfFormState> = {
  formOf: (rules) => ({ tf: rules.tf ? tfForm(rules.tf) : null }),
  bodyOf: ({ tf }) => (tf ? { rulesetConfig: tf } : {}),
};
