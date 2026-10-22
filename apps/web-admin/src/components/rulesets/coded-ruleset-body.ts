/**
 * The `tfConfig` half of a coded ruleset's write payload, in one place.
 *
 * A coded ruleset (TF v1 itself, or a `base_code` fork of it) has no authored
 * score formula — its tunables live in `tf_config`, which the API merges over
 * the coded defaults at tournament creation. Three surfaces write that shape:
 * the super-admin edit page, the org edit page, and the org clone/adopt page.
 * This is the single owner.
 *
 * A Save writes back what the ruleset stores, with only the author's changes
 * applied (operator rulings 59 and 136): its own match format, win bonus and
 * double penalty (each removed when it follows the engine), and the targets
 * only when the list's values changed. A key the editor does not carry stays as
 * stored. `stored` is the row's `tf_config`, or the SOURCE's on a copy.
 *
 * Pure: no React, no I/O.
 */

import type { Target } from '@myclash/rulesets';
import type { RulesetSubmitValue } from './RulesetForm';

type TfConfig = Record<string, unknown>;

/** Whether the targets the author leaves differ from those the form started with, by value. */
export function targetsChanged(before: Target[], after: Target[]): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function setOrDelete(config: TfConfig, key: string, value: unknown): void {
  if (value === undefined || value === null) delete config[key];
  else config[key] = value;
}

export function codedRulesetTfConfig(
  stored: TfConfig | null | undefined,
  data: Pick<RulesetSubmitValue, 'targets' | 'matchFormatDefaults' | 'ownCoded'>,
  startTargets: Target[],
): TfConfig {
  const next: TfConfig = { ...(stored ?? {}) };
  setOrDelete(next, 'matchFormat', data.matchFormatDefaults);
  setOrDelete(next, 'winBonus', data.ownCoded?.winBonus);
  setOrDelete(next, 'doublePenaltyFormula', data.ownCoded?.doublePenaltyFormula);
  if (targetsChanged(startTargets, data.targets)) {
    // Named targets are the source of truth. Mirror the first two into the legacy deep/shallow
    // pair the API paths that still read it expect.
    next['targets'] = data.targets;
    next['targetValues'] = {
      deepTarget: data.targets[0]?.value,
      shallowTarget: data.targets[1]?.value,
    };
  }
  return next;
}
