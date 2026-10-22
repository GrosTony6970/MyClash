/**
 * Hydration shared by every RulesetForm mount (super-admin edit, org
 * read-only edit, org clone): turn a `custom_rulesets` row into the
 * form's own match format, double-penalty formula, TF v1 dials, targets and
 * afterblow.
 *
 * The form starts from the ruleset's OWN values, exactly as stored (operator
 * ruling 59): nothing is filled in, so a field the ruleset does not store stays
 * empty and follows the engine. What the box shows for it is
 * `ruleset-own-values`' business. For TF v1 and its copies the store is the
 * `tf_config` JSONB column (the PATCH writes `tfConfig`); for a club formula
 * ruleset it is the flat `match_format_defaults` / `double_penalty_formula`
 * columns. Reading the wrong one is the bug where the org view of TF v1 showed
 * the editor's own fallbacks instead of the configured values.
 *
 * Pure: no React, no I/O.
 */

import { DEFAULT_TARGETS, type DoublePenaltySpec, type Target } from '@myclash/rulesets';
import { DEFAULT_AFTERBLOW_GRAMMAR, type AfterblowGrammar } from './AfterblowGrammarEditor';
import { isCodedRuleset } from './ruleset-kind';
import type { OwnCoded, OwnMatchFormat } from './ruleset-own-values';

export { isCodedRuleset };

export interface RulesetRowLike {
  code: string;
  /** Set on a coded fork: the built-in coded engine it reuses (e.g. 'TF_v1'). */
  base_code?: string | null;
  match_format_defaults: OwnMatchFormat | null;
  double_penalty_formula: DoublePenaltySpec | null;
  /** The grammar columns (migrations 0143/0145). Null on a row predating them. */
  targets?: Target[] | null;
  has_afterblow?: boolean | null;
  afterblow_mode?: 'full' | 'deductive' | null;
  afterblow_valuation?: 'fixed' | 'weighted' | null;
  afterblow_fixed_value?: number | null;
  tf_config?: {
    winBonus?: number;
    targets?: Target[];
    targetValues?: { deepTarget?: number; shallowTarget?: number };
    matchFormat?: OwnMatchFormat;
    doublePenaltyFormula?: DoublePenaltySpec;
  } | null;
}

/**
 * Named targets for the form: what the engine plays. A TF v1 ruleset plays
 * `tf_config.targets`, else the engine's own (its defaults always hold a list, so
 * a stored legacy `targetValues` pair alone is never read, and the flat column is
 * the Discover card's count, not what is scored). A club formula ruleset plays
 * its `targets` column.
 */
function initialTargets(row: RulesetRowLike, isCoded: boolean): Target[] {
  const own = isCoded ? row.tf_config?.targets : row.targets;
  return own && own.length > 0 ? own : [...DEFAULT_TARGETS];
}

/** The TF v1 dials the ruleset stores as its own: absent ones follow the engine. */
function initialOwnCoded(tfCfg: NonNullable<RulesetRowLike['tf_config']>): OwnCoded {
  const own: OwnCoded = {};
  if (tfCfg.winBonus !== undefined) own.winBonus = tfCfg.winBonus;
  if (tfCfg.doublePenaltyFormula !== undefined) {
    own.doublePenaltyFormula = tfCfg.doublePenaltyFormula;
  }
  return own;
}

export function rulesetFormInitial(row: RulesetRowLike): {
  ownMatchFormat: OwnMatchFormat;
  ownCoded: OwnCoded;
  /** A club formula ruleset's own double penalty (a TF v1 ruleset's is in `ownCoded`). */
  doublePenaltyFormula: DoublePenaltySpec | null;
  targets: Target[];
  afterblow: AfterblowGrammar;
} {
  const isCoded = isCodedRuleset(row.code, row.base_code);
  const tfCfg = row.tf_config ?? {};

  return {
    ownMatchFormat: { ...((isCoded ? tfCfg.matchFormat : row.match_format_defaults) ?? {}) },
    ownCoded: isCoded ? initialOwnCoded(tfCfg) : {},
    doublePenaltyFormula: isCoded ? null : (row.double_penalty_formula ?? null),
    targets: initialTargets(row, isCoded),
    afterblow: {
      // TF_v1's afterblow grammar is federal and lives in code, not the row —
      // its columns are null on the mirror. Default to the federal fixed/1/full,
      // so the read-only-for-TF_v1 controls show its real behaviour.
      hasAfterblow: row.has_afterblow ?? (isCoded ? true : DEFAULT_AFTERBLOW_GRAMMAR.hasAfterblow),
      afterblowValuation: row.afterblow_valuation ?? DEFAULT_AFTERBLOW_GRAMMAR.afterblowValuation,
      afterblowFixedValue:
        row.afterblow_fixed_value ?? DEFAULT_AFTERBLOW_GRAMMAR.afterblowFixedValue,
      afterblowMode:
        row.afterblow_mode ?? (isCoded ? 'deductive' : DEFAULT_AFTERBLOW_GRAMMAR.afterblowMode),
    },
  };
}
