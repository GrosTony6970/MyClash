/**
 * The TF_v1 settings form (the Advanced tab and wizard Step 4): win bonus, target values and the
 * Tournament policy, read from the rules in force the API answers (`effectiveRules.tf`), never
 * from a default of its own (operator rulings 43, 46). It filled a missing forfeit rule with 2 and
 * a Save wrote it, turning on a rule nobody chose. The forfeit rule's Off is a null (ruling 52).
 */

import type { EffectiveTfRules } from '@myclash/types';
import type { RulesFormSpec } from './useEffectiveRules';

export interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  tournamentPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    /** Null: the rule is off (`disqualifyAfterOf`). */
    disqualifyAfter: number | null;
  };
}

/** The form of TF_v1's settings in force, each field picked by name. */
export function tfForm(tf: EffectiveTfRules): RulesetConfigTF {
  return {
    winBonus: tf.winBonus,
    targetValues: {
      deepTarget: tf.targetValues.deepTarget,
      shallowTarget: tf.targetValues.shallowTarget,
    },
    tournamentPolicy: {
      forfeitDrawsCount: tf.tournamentPolicy.forfeitDrawsCount,
      forfeitFighterBefore1stMatch: tf.tournamentPolicy.forfeitFighterBefore1stMatch,
      disqualifyAfter: tf.tournamentPolicy.disqualifyAfter,
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
