/**
 * apps/api/src/modules/events/ruleset-row-projection.ts
 *
 * The PURE halves of the two ruleset resolvers in `ruleset-defaults.ts`:
 * turning a `custom_rulesets` row into the grammar and the effective config it
 * describes, with every fallback applied.
 *
 * They live apart from the resolvers because two callers need them by different
 * routes: `resolveRulesetGrammar` / `resolveRulesetConfigDefaults` fetch a row
 * and then project it, while a LIST read (the lineage lamps) already holds the
 * rows and must project them without a second query per row. Sharing the
 * projection rather than re-deriving it is the whole point — the lamps and the
 * seeder have to agree on what a ruleset effectively does, and two hand-written
 * copies of these fallbacks is exactly how they would drift apart.
 *
 * Pure: no Supabase, no I/O. The column constants sit here too, so a caller
 * assembling its own select cannot silently omit a field the projection reads
 * (a missing column reads as a DEFAULT, i.e. a silently wrong answer).
 */
import {
  DEFAULT_TARGETS,
  GenericPointsCapDefaultConfig,
  TFv1DefaultConfig,
} from '@myclash/rulesets';
import { deepMergeJson } from '../../common/deep-merge';

// ── Static defaults ──────────────────────────────────────────────────────────

/**
 * Canonical defaults keyed by `${code}:${normalisedVersion}`.
 * "1" and "1.0.0" are treated as the same version for all built-in rulesets.
 */
const RULESET_DEFAULTS: Record<string, Record<string, unknown>> = {
  'TF_v1:1': TFv1DefaultConfig as Record<string, unknown>,
  'TF_v1:1.0.0': TFv1DefaultConfig as Record<string, unknown>,
  'Generic_PointsCap:1': GenericPointsCapDefaultConfig as Record<string, unknown>,
  'Generic_PointsCap:1.0.0': GenericPointsCapDefaultConfig as Record<string, unknown>,
};

/**
 * Map the various shorthand version strings the API accepts ('1', '1.0', etc.)
 * to the canonical version used by the @myclash/rulesets registry ('1.0.0').
 *
 * Keeps change-detection in `updateTournament` from spuriously firing when a
 * caller passes a shorthand that's semantically identical to the stored value.
 */
export function normalizeRulesetVersion(version: string): string {
  if (version === '1' || version === '1.0') return '1.0.0';
  return version;
}

/**
 * Returns a deep copy of the default `ruleset_config` for the given
 * ruleset code + version.  Falls back to an empty object if the ruleset is
 * unknown (e.g. a DB-authored FormulaRuleset whose defaults aren't statically
 * known here).
 */
export function defaultRulesetConfigFor(code: string, version: string): Record<string, unknown> {
  const key = `${code}:${version}`;
  const defaults = RULESET_DEFAULTS[key];
  return defaults ? structuredClone(defaults) : {};
}

// ── Effective config ─────────────────────────────────────────────────────────

/** The `custom_rulesets` columns {@link codedConfigFromRow} reads. */
export const CUSTOM_RULESET_CONFIG_COLUMNS =
  'match_format_defaults, double_penalty_formula, base_code, base_version, tf_config';

export interface CustomRulesetConfigRow {
  match_format_defaults: Record<string, unknown> | null;
  // JSONB since migration 0146: a whitelist key string OR an authored AST
  // object (DoublePenaltySpec). Passed through as-is — the tournament stores
  // and the engine reads whichever shape it is.
  double_penalty_formula: unknown;
  base_code: string | null;
  base_version: string | null;
  tf_config: Record<string, unknown> | null;
}

/** The effective config of a non-system `custom_rulesets` row. */
export function codedConfigFromRow(row: CustomRulesetConfigRow): Record<string, unknown> {
  // A CODED FORK (base_code set) reuses its base ruleset's coded algorithm, so
  // it must seed from the base's static defaults with the fork's tf_config
  // overrides merged on top — the same shape the system path produces, but for
  // a non-system row. Without this a fork of TF_v1 would seed an empty config
  // and lose winBonus / matchFormat / doublePenaltyFormula.
  if (row.base_code) {
    const baseDefaults = defaultRulesetConfigFor(
      row.base_code,
      normalizeRulesetVersion(row.base_version ?? '1.0.0'),
    );
    if (Object.keys(baseDefaults).length > 0) {
      return row.tf_config
        ? (deepMergeJson(baseDefaults, row.tf_config) as Record<string, unknown>)
        : baseDefaults;
    }
  }

  const out: Record<string, unknown> = {};
  if (row.match_format_defaults) out['matchFormat'] = row.match_format_defaults;
  if (row.double_penalty_formula) out['doublePenaltyFormula'] = row.double_penalty_formula;
  return out;
}

// ── Grammar ──────────────────────────────────────────────────────────────────

/**
 * What a ruleset declares about what an exchange can be and what it is worth.
 * The shape `buildScoringButtons` consumes.
 */
export interface ResolvedRulesetGrammar {
  targets: Array<{ name: string; value: number }>;
  hasAfterblow: boolean;
  afterblowValuation: 'fixed' | 'weighted';
  afterblowFixedValue: number;
  defaultAfterblowMode: 'full' | 'deductive';
  /**
   * Whether the ruleset has a pool-only doubles CEILING. Drives whether the
   * tournament form offers one, the way `hasAfterblow` drives afterblow.
   *
   * True for everything except `Generic_PointsCap`: the ceiling lives on the
   * shared match format, so every ruleset inherited it, and a custom ruleset
   * that says nothing keeps the behaviour it already had.
   */
  hasMaxDoubles: boolean;
}

export const FALLBACK_GRAMMAR: ResolvedRulesetGrammar = {
  targets: [...DEFAULT_TARGETS],
  hasAfterblow: false,
  afterblowValuation: 'fixed',
  afterblowFixedValue: 1,
  defaultAfterblowMode: 'full',
  hasMaxDoubles: true,
};

/** The `custom_rulesets` columns {@link grammarFromRow} reads. */
export const CUSTOM_RULESET_GRAMMAR_COLUMNS =
  'targets, has_afterblow, afterblow_mode, afterblow_valuation, afterblow_fixed_value';

export interface CustomRulesetGrammarRow {
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
}

/** A non-system row's grammar: empty targets fall back to DEFAULT_TARGETS, and
 *  the afterblow fields only count when the ruleset declares an afterblow. */
export function grammarFromRow(row: CustomRulesetGrammarRow): ResolvedRulesetGrammar {
  const hasAfterblow = row.has_afterblow ?? false;
  return {
    targets: row.targets?.length ? row.targets : [...DEFAULT_TARGETS],
    hasAfterblow,
    afterblowValuation: hasAfterblow ? (row.afterblow_valuation ?? 'fixed') : 'fixed',
    afterblowFixedValue: hasAfterblow ? (row.afterblow_fixed_value ?? 1) : 1,
    defaultAfterblowMode: hasAfterblow ? (row.afterblow_mode ?? 'full') : 'full',
    // An org-authored ruleset keeps the ceiling — the operator's ruling is that
    // only `Generic_PointsCap` is without one.
    hasMaxDoubles: true,
  };
}
