/**
 * The `tfConfig` half of a coded ruleset's write payload, in one place.
 *
 * A coded ruleset (TF v1 itself, or a `base_code` fork of it) has no authored
 * score formula — its tunables live in `tf_config`, which the API merges over
 * the coded defaults at tournament creation. Three surfaces now write that
 * shape: the super-admin edit page, the org edit page, and the org clone/adopt
 * page. They were drifting copies; this is the single owner.
 *
 * Scoped to the `tfConfig` object ONLY. Whether a caller ALSO sends the flat
 * `targets` column differs per surface on purpose — the super-admin page sends
 * it for a fork but not for the TF v1 parent row — so that decision stays at
 * the call site.
 *
 * Pure: no React, no I/O.
 */

import type { DoublePenaltySpec, Target } from '@myclash/rulesets';
import type { MatchFormatDefaults, TfV1Internals } from './RulesetForm';

/** The subset of `RulesetForm`'s submit value a coded ruleset actually stores. */
export interface CodedRulesetSubmitValue {
  targets: Target[];
  matchFormatDefaults: MatchFormatDefaults;
  doublePenaltyFormula: DoublePenaltySpec | null;
  tfV1Internals?: TfV1Internals;
}

export interface CodedRulesetTfConfig {
  winBonus: number | undefined;
  targets: Target[];
  targetValues: { deepTarget: number | undefined; shallowTarget: number | undefined };
  matchFormat: MatchFormatDefaults;
  doublePenaltyFormula: DoublePenaltySpec | undefined;
}

export function codedRulesetTfConfig(data: CodedRulesetSubmitValue): CodedRulesetTfConfig {
  return {
    winBonus: data.tfV1Internals?.winBonus,
    // Named targets are the source of truth in the editor. Mirror the first two
    // into the legacy deep/shallow pair TF_v1 scoring reads today, and persist
    // the full list for the Phase-2 engine.
    targets: data.targets,
    targetValues: {
      deepTarget: data.targets[0]?.value,
      shallowTarget: data.targets[1]?.value,
    },
    matchFormat: data.matchFormatDefaults,
    doublePenaltyFormula: data.doublePenaltyFormula || undefined,
  };
}
