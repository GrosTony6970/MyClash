/**
 * apps/api/src/modules/events/ruleset-defaults.ts
 *
 * Returns the default `ruleset_config` JSONB shape for a given ruleset code +
 * version.  Used by `updateTournament` when a `rulesetCode` switch wipes the
 * stale config of the previous ruleset and seeds the new one from scratch.
 *
 * Design decision — hardcoded map, not registry lookup:
 *   The `Ruleset` interface (packages/rulesets/src/types.ts) does NOT expose a
 *   `defaults` field, and adding one to the interface + all three implementations
 *   would be invasive for a purely API-layer concern.  Instead, we import the
 *   already-exported `*DefaultConfig` constants directly.  This keeps the
 *   rulesets package unchanged and makes the defaults statically visible here.
 *
 *   Version aliases: the registered versions are "1.0.0" for all built-in
 *   rulesets, but callers (DTO, wizard, tests) may pass the shorthand "1".
 *   We normalise both to the same defaults entry.
 */
import {
  TFv1DefaultConfig,
  GenericPointsCapDefaultConfig,
  DEFAULT_TARGETS,
  registry,
  type RulesetMetadata,
} from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';
import { deepMergeJson } from '../../common/deep-merge';

type DefaultsMap = Record<string, Record<string, unknown>>;

/**
 * Canonical defaults keyed by `${code}:${normalisedVersion}`.
 * "1" and "1.0.0" are treated as the same version for all built-in rulesets.
 */
const RULESET_DEFAULTS: DefaultsMap = {
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

/**
 * Like `defaultRulesetConfigFor` but also consults the `custom_rulesets`
 * table for non-system ruleset codes — so a tournament created with a
 * custom ruleset inherits the operator-defined `match_format_defaults` and
 * `double_penalty_formula` rather than starting from an empty object.
 *
 * The custom values land in the canonical TF_v1-shaped config under
 * `matchFormat` and `doublePenaltyFormula`, which is the shape every
 * tournament stores (see validateTournamentRulesetConfig).
 */
export async function resolveRulesetConfigDefaults(
  supabase: SupabaseService,
  code: string,
  version: string,
): Promise<Record<string, unknown>> {
  const staticDefaults = defaultRulesetConfigFor(code, version);

  // For TF v1 (and any future system ruleset with a `tf_config` override
  // column), let the super-admin's DB-stored overrides take precedence over
  // the static defaults. The merge is deep so a partial override (e.g. just
  // winBonus) only replaces that field and leaves the rest of the schema-
  // shaped defaults intact.
  if (Object.keys(staticDefaults).length > 0) {
    const overrides = await loadSystemRulesetOverrides(supabase, code);
    if (overrides) return deepMergeJson(staticDefaults, overrides) as Record<string, unknown>;
    return staticDefaults;
  }

  // Unknown to the static map — look it up in custom_rulesets.
  const { data } = await supabase.service
    .from('custom_rulesets')
    .select('match_format_defaults, double_penalty_formula')
    .eq('code', code)
    .maybeSingle();
  if (!data) return {};

  const row = data as {
    match_format_defaults: Record<string, unknown> | null;
    double_penalty_formula: string | null;
  };
  const out: Record<string, unknown> = {};
  if (row.match_format_defaults) out['matchFormat'] = row.match_format_defaults;
  if (row.double_penalty_formula) out['doublePenaltyFormula'] = row.double_penalty_formula;
  return out;
}

/**
 * Read `tf_config` (Round 7) for a system ruleset from the custom_rulesets
 * mirror row. The DB row is shaped like a TFv1ConfigSchema patch (any subset
 * of winBonus / targetValues / matchFormat / doublePenaltyFormula /
 * forfeitPolicy). Returns null when the row or column is missing — the
 * resolver then keeps the static defaults unchanged.
 */
async function loadSystemRulesetOverrides(
  supabase: SupabaseService,
  code: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.service
    .from('custom_rulesets')
    .select('tf_config, is_system')
    .eq('code', code)
    .maybeSingle();
  if (!data) return null;
  const row = data as { tf_config: Record<string, unknown> | null; is_system: boolean };
  if (!row.is_system) return null;
  return row.tf_config ?? null;
}

/**
 * Mark every matching `custom_ruleset_versions` row as frozen. Called after a
 * tournament is created/updated to pin a (code, version) so future edits to
 * that version are rejected (and the operator is prompted to publish a new
 * version instead).
 *
 * No-op for system rulesets (the parent row is is_system=true) and for
 * versions that have never been snapshotted (drafts pinned to a tournament
 * before publish will materialise on the next publish, and the snapshot
 * insert is the moment the freeze normally needs to apply).
 */
export async function freezeRulesetVersion(
  supabase: SupabaseService,
  code: string,
  version: string,
): Promise<void> {
  const { data: parent } = await supabase.service
    .from('custom_rulesets')
    .select('id, is_system')
    .eq('code', code)
    .maybeSingle();
  if (!parent) return;
  const parentRow = parent as { id: string; is_system: boolean };
  if (parentRow.is_system) return;

  await supabase.service
    .from('custom_ruleset_versions')
    .update({ is_frozen: true })
    .eq('custom_ruleset_id', parentRow.id)
    .eq('version', version);
}

// ── Ruleset grammar ──────────────────────────────────────────────────────────

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
}

const FALLBACK_GRAMMAR: ResolvedRulesetGrammar = {
  targets: [...DEFAULT_TARGETS],
  hasAfterblow: false,
  afterblowValuation: 'fixed',
  afterblowFixedValue: 1,
  defaultAfterblowMode: 'full',
};

/**
 * Resolve a ruleset's grammar for SEEDING purposes.
 *
 * Deliberately NOT `RulesetResolver.resolve()`, which is the scoring-time
 * resolver and returns null for `is_system` rows and for anything whose status
 * is not 'published'. Both are exactly the cases seeding must handle:
 *
 *   - every built-in is `is_system`, so the common case would resolve to null;
 *   - a tournament can legitimately be created against a DRAFT custom ruleset
 *     (see freezeRulesetVersion's docblock — drafts pinned before publish are a
 *     supported flow), and a null there would silently seed FFAMHE's pad onto a
 *     federation that declared something else. Unlike today's NULL config, a
 *     seeded wrong value is materialised, sticky, and never re-derived.
 *
 * Refusing to SCORE with an unpublished ruleset and refusing to READ ITS
 * GRAMMAR are different concerns; this function only does the latter.
 */
export async function resolveRulesetGrammar(
  supabase: SupabaseService,
  code: string,
  version: string,
): Promise<ResolvedRulesetGrammar> {
  const coded = registry.has(code, version) ? registry.get(code, version) : null;
  if (coded) return fromMetadata(coded.metadata);

  const { data } = await supabase.service
    .from('custom_rulesets')
    .select('targets, has_afterblow, afterblow_mode, afterblow_valuation, afterblow_fixed_value')
    .eq('code', code)
    .maybeSingle();
  if (!data) return { ...FALLBACK_GRAMMAR, targets: [...DEFAULT_TARGETS] };

  const row = data as {
    targets: Array<{ name: string; value: number }> | null;
    has_afterblow: boolean | null;
    afterblow_mode: 'full' | 'deductive' | null;
    afterblow_valuation: 'fixed' | 'weighted' | null;
    afterblow_fixed_value: number | null;
  };
  const hasAfterblow = row.has_afterblow ?? false;
  return {
    targets: row.targets?.length ? row.targets : [...DEFAULT_TARGETS],
    hasAfterblow,
    afterblowValuation: hasAfterblow ? (row.afterblow_valuation ?? 'fixed') : 'fixed',
    afterblowFixedValue: hasAfterblow ? (row.afterblow_fixed_value ?? 1) : 1,
    defaultAfterblowMode: hasAfterblow ? (row.afterblow_mode ?? 'full') : 'full',
  };
}

function fromMetadata(metadata: RulesetMetadata | undefined): ResolvedRulesetGrammar {
  const hasAfterblow = metadata?.hasAfterblow ?? false;
  const targets = metadata?.targets;
  return {
    targets: targets?.length ? targets.map((t) => ({ ...t })) : [...DEFAULT_TARGETS],
    hasAfterblow,
    afterblowValuation: hasAfterblow ? (metadata?.afterblowValuation ?? 'fixed') : 'fixed',
    afterblowFixedValue: hasAfterblow ? (metadata?.afterblowFixedValue ?? 1) : 1,
    defaultAfterblowMode: hasAfterblow ? (metadata?.defaultAfterblowMode ?? 'full') : 'full',
  };
}
