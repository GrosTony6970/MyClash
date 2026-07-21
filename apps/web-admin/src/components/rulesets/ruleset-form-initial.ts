/**
 * Hydration shared by every RulesetForm mount (super-admin edit, org
 * read-only edit, org clone): turn a `custom_rulesets` row into the
 * form's match-format defaults, double-penalty formula, and TF v1
 * internals.
 *
 * For TF v1 the canonical store is the `tf_config` JSONB column (the
 * super-admin PATCH writes `tfConfig`; the API merges it over the code
 * defaults at tournament creation). For custom rulesets it's the flat
 * `match_format_defaults` / `double_penalty_formula` columns. Reading
 * the wrong one is exactly the bug where the org view of TF v1 showed
 * the generic 5/180 fallbacks instead of the configured 10/90.
 *
 * Pure: no React, no I/O.
 */

import { DEFAULT_TARGETS, type Target } from '@myclash/rulesets';
import {
  DEFAULT_MATCH_FORMAT_DEFAULTS,
  DEFAULT_TF_V1_INTERNALS,
  type MatchFormatDefaults,
  type TfV1Internals,
} from './RulesetForm';

export interface RulesetRowLike {
  code: string;
  match_format_defaults: Partial<MatchFormatDefaults> | null;
  double_penalty_formula: string | null;
  /** The grammar column (migration 0143). Null for a row that predates it. */
  targets?: Target[] | null;
  tf_config?: {
    winBonus?: number;
    targets?: Target[];
    targetValues?: { deepTarget?: number; shallowTarget?: number };
    matchFormat?: Partial<MatchFormatDefaults>;
    doublePenaltyFormula?: string;
  } | null;
}

/**
 * Named targets for the form, sourced in priority order:
 *  - an authored `targets` list (custom rulesets, or a TF_v1 tf_config that
 *    already carries one);
 *  - TF_v1's legacy `tf_config.targetValues` deep/shallow pair, so a federal
 *    ruleset shows its two configured values rather than the generic default;
 *  - the federal default.
 */
function initialTargets(
  row: RulesetRowLike,
  tfCfg: NonNullable<RulesetRowLike['tf_config']>,
): Target[] {
  if (row.targets && row.targets.length > 0) return row.targets;
  if (tfCfg.targets && tfCfg.targets.length > 0) return tfCfg.targets;
  const tv = tfCfg.targetValues;
  if (tv && (typeof tv.deepTarget === 'number' || typeof tv.shallowTarget === 'number')) {
    const derived: Target[] = [];
    if (typeof tv.deepTarget === 'number') derived.push({ name: 'Deep', value: tv.deepTarget });
    if (typeof tv.shallowTarget === 'number')
      derived.push({ name: 'Shallow', value: tv.shallowTarget });
    if (derived.length > 0) return derived;
  }
  return [...DEFAULT_TARGETS];
}

export function rulesetFormInitial(row: RulesetRowLike): {
  matchFormatDefaults: MatchFormatDefaults;
  doublePenaltyFormula: string;
  tfV1Internals: TfV1Internals;
  targets: Target[];
} {
  const isTfV1 = row.code === 'TF_v1';
  const tfCfg = row.tf_config ?? {};

  const matchFormatSource = isTfV1
    ? (tfCfg.matchFormat ?? null)
    : (row.match_format_defaults ?? null);
  const doublePenaltySource = isTfV1
    ? (tfCfg.doublePenaltyFormula ?? '')
    : (row.double_penalty_formula ?? '');

  const tfV1Internals: TfV1Internals = isTfV1
    ? {
        winBonus: tfCfg.winBonus ?? DEFAULT_TF_V1_INTERNALS.winBonus,
        deepTarget: tfCfg.targetValues?.deepTarget ?? DEFAULT_TF_V1_INTERNALS.deepTarget,
        shallowTarget: tfCfg.targetValues?.shallowTarget ?? DEFAULT_TF_V1_INTERNALS.shallowTarget,
      }
    : DEFAULT_TF_V1_INTERNALS;

  return {
    matchFormatDefaults: {
      ...DEFAULT_MATCH_FORMAT_DEFAULTS,
      ...(matchFormatSource ?? {}),
      timeLimitsSeconds: {
        ...DEFAULT_MATCH_FORMAT_DEFAULTS.timeLimitsSeconds,
        ...(matchFormatSource?.timeLimitsSeconds ?? {}),
      },
    },
    doublePenaltyFormula: doublePenaltySource,
    tfV1Internals,
    targets: initialTargets(row, tfCfg),
  };
}
