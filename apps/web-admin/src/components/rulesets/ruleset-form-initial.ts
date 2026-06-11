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
  tf_config?: {
    winBonus?: number;
    targetValues?: { deepTarget?: number; shallowTarget?: number };
    matchFormat?: Partial<MatchFormatDefaults>;
    doublePenaltyFormula?: string;
  } | null;
}

export function rulesetFormInitial(row: RulesetRowLike): {
  matchFormatDefaults: MatchFormatDefaults;
  doublePenaltyFormula: string;
  tfV1Internals: TfV1Internals;
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
  };
}
