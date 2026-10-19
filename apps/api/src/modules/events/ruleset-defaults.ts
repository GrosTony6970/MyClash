/**
 * apps/api/src/modules/events/ruleset-defaults.ts
 *
 * Returns the default `ruleset_config` JSONB shape for a given ruleset code +
 * version.  Used when a Tournament's pair moves (`settingsAfterMove`): a new
 * code, or a club ruleset's other version, is seeded from these.
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
import { DEFAULT_TARGETS, type RulesetMetadata, type RulesetRegistry } from '@myclash/rulesets';
import { buildScoringButtons } from '@myclash/types';
import type { SupabaseService } from '../supabase/supabase.service';
import { deepMergeJson } from '../../common/deep-merge';
import {
  codedConfigFromRow,
  CUSTOM_RULESET_CONFIG_COLUMNS,
  CUSTOM_RULESET_GRAMMAR_COLUMNS,
  defaultRulesetConfigFor,
  defaultRulesetVersion,
  FALLBACK_GRAMMAR,
  grammarFromRow,
  normalizeRulesetVersion,
  type CustomRulesetConfigRow,
  type CustomRulesetGrammarRow,
  type ResolvedRulesetGrammar,
} from './ruleset-row-projection';

// The pure projections live in a leaf module (see its docblock: a list read
// needs them without a per-row query). Re-exported here so the many existing
// importers of this file keep one import site.
export {
  codedConfigFromRow,
  CUSTOM_RULESET_CONFIG_COLUMNS,
  CUSTOM_RULESET_GRAMMAR_COLUMNS,
  defaultRulesetConfigFor,
  defaultRulesetVersion,
  grammarFromRow,
  normalizeRulesetVersion,
};
export type { CustomRulesetConfigRow, CustomRulesetGrammarRow, ResolvedRulesetGrammar };

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

  // Unknown to the static map — look it up in custom_rulesets. The parent row,
  // whatever version is asked: only a ruleset's current version is offered.
  const { data, error } = await supabase.service
    .from('custom_rulesets')
    .select(CUSTOM_RULESET_CONFIG_COLUMNS)
    .eq('code', code)
    .maybeSingle();
  // A failed read is not "no settings": read as none, the defaults were written as {}.
  if (error)
    throw new Error(`The settings of ruleset ${code}@${version} were not read: ${error.message}`);
  if (!data) return {};
  return codedConfigFromRow(data as CustomRulesetConfigRow);
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
  const { data, error } = await supabase.service
    .from('custom_rulesets')
    .select('tf_config, is_system')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(`The overrides of ruleset ${code} were not read: ${error.message}`);
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
 * Resolve a ruleset's grammar for SEEDING purposes.
 *
 * Deliberately NOT `RulesetResolver.resolve()`, which is the scoring-time
 * resolver and returns null for `is_system` rows: every built-in is
 * `is_system`, so the common case would resolve to null, and a null here would
 * silently seed FFAMHE's pad onto a federation that declared something else.
 * Unlike today's NULL config, a seeded wrong value is materialised, sticky, and
 * never re-derived. (A DRAFT custom ruleset is read here as it is scored: a
 * Tournament pinned to one is scored as its draft, ruling 6.)
 *
 * A formula ruleset's version is read as the scorer reads it: the published
 * snapshot of that version when there is one, else the parent row (a draft, or
 * a row older than the snapshots). A coded fork has no formula snapshot: its
 * row is read, as the resolver does. A failed read throws: read as "none", the
 * fallback grammar was seeded and hashed as the ruleset's.
 */
export async function resolveRulesetGrammar(
  supabase: SupabaseService,
  registry: RulesetRegistry,
  code: string,
  version: string,
): Promise<ResolvedRulesetGrammar> {
  const coded = registry.has(code, version) ? registry.get(code, version) : null;
  if (coded) return fromMetadata(coded.metadata);

  const { data, error } = await supabase.service
    .from('custom_rulesets')
    .select(`id, base_code, ${CUSTOM_RULESET_GRAMMAR_COLUMNS}`)
    .eq('code', code)
    .maybeSingle();
  if (error)
    throw new Error(`The grammar of ruleset ${code}@${version} was not read: ${error.message}`);
  if (!data) return { ...FALLBACK_GRAMMAR, targets: [...DEFAULT_TARGETS] };
  const parent = data as CustomRulesetGrammarRow & { id: string; base_code: string | null };
  if (parent.base_code) return grammarFromRow(parent);
  const snapshot = await supabase.service
    .from('custom_ruleset_versions')
    .select(CUSTOM_RULESET_GRAMMAR_COLUMNS)
    .eq('custom_ruleset_id', parent.id)
    .eq('version', version)
    .maybeSingle();
  if (snapshot.error)
    throw new Error(
      `The grammar of ruleset ${code}@${version} was not read: ${snapshot.error.message}`,
    );
  return grammarFromRow((snapshot.data as CustomRulesetGrammarRow | null) ?? parent);
}

/**
 * The raw `scoring_config_json` a new tournament is seeded with, derived from
 * its ruleset's grammar. Returned UN-normalized — the caller runs it through
 * `normalizeTournamentScoringConfig` (and merges any explicit override) so the
 * stored blob is byte-identical to what a PATCH produces.
 *
 * The buttons press the targets the engine scores (operator ruling "Formula
 * targets"): a club FORMULA scores its own (the grammar's), whatever default
 * list the Tournament's settings carry; a CODED engine (TF_v1, a fork) scores
 * the settings' `targets` — they carry a fork's tf_config or a super-admin's
 * overrides, which the static grammar does not — else the grammar's. The ONE
 * owner of the seed: Tournament create and every move of its pair
 * (`seededScoringOfMove`). A legacy `targetValues` override is deliberately NOT
 * honoured — that field is inert and deprecated, and wiring it in here would
 * make it affect scoring, which belongs to the authoring-UI migration rather
 * than this seed.
 */
export function buildSeededScoringConfig(
  grammar: ResolvedRulesetGrammar,
  rulesetConfig: Record<string, unknown>,
  kind: 'coded' | 'formula',
): Record<string, unknown> {
  const configTargets = kind === 'coded' ? rulesetConfig['targets'] : undefined;
  return {
    afterblowMode: grammar.defaultAfterblowMode,
    buttons: buildScoringButtons({
      targets:
        Array.isArray(configTargets) && configTargets.length > 0
          ? (configTargets as Array<{ name: string; value: number }>)
          : grammar.targets,
      hasAfterblow: grammar.hasAfterblow,
      afterblowValuation: grammar.afterblowValuation,
      afterblowFixedValue: grammar.afterblowFixedValue,
    }),
    // The wizard configures display in Step 3; seed the same shape the
    // normalizer produces, so the first PATCH deep-merges cleanly.
    display: { sideColors: { red: 'red', blue: 'blue' }, quickPenalties: [] },
  };
}

/**
 * True when (code, version) is a built-in coded ruleset served from the
 * in-memory registry (TF_v1, Generic_PointsCap, …) rather than a DB row. These
 * are the rulesets a "Customise this format" fork copies FROM.
 */
export function isSystemRuleset(registry: RulesetRegistry, code: string, version: string): boolean {
  return registry.has(code, normalizeRulesetVersion(version));
}

/**
 * The human display name of a ruleset, for public surfaces that must not render
 * a raw code (no-raw-IDs-in-UI). Built-ins come from the registry; custom rows
 * from `custom_rulesets.name`. Falls back to the code itself if nothing resolves
 * — a label is display-only, never load-bearing, so it degrades quietly.
 */
export async function resolveRulesetLabel(
  supabase: SupabaseService,
  registry: RulesetRegistry,
  code: string,
  version: string,
): Promise<string> {
  const v = normalizeRulesetVersion(version);
  if (registry.has(code, v)) return registry.get(code, v).displayName;
  const { data } = await supabase.service
    .from('custom_rulesets')
    .select('name')
    .eq('code', code)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? code;
}

/**
 * The `custom_rulesets` INSERT payload for a CODED FORK (migration 0148): a
 * private, org-owned copy of a system ruleset that reuses its coded algorithm
 * (`base_code`) and carries the operator's captured parameters (`tfConfig`) and
 * grammar. `score_formula`/`constants`/`tiebreakers` are empty by construction —
 * the resolver short-circuits a base_code row to the coded engine, so they are
 * never read. Published immediately and private (`public_visibility: false`),
 * exactly like an org-authored formula ruleset.
 */
export interface CodedForkRowParams {
  code: string;
  baseCode: string;
  baseVersion: string;
  name: string;
  ownerOrganizationId: string;
  actorUserId: string;
  tfConfig: Record<string, unknown>;
  grammar: ResolvedRulesetGrammar;
}

export function buildCodedForkRow(p: CodedForkRowParams): Record<string, unknown> {
  const ab = p.grammar.hasAfterblow;
  return {
    code: p.code,
    version: '1.0.0',
    name: p.name,
    status: 'published',
    base_code: p.baseCode,
    base_version: p.baseVersion,
    tf_config: p.tfConfig,
    score_formula: {},
    constants: {},
    tiebreakers: [],
    match_format_defaults: null,
    double_penalty_formula: null,
    targets: p.grammar.targets,
    has_afterblow: ab,
    afterblow_mode: ab ? p.grammar.defaultAfterblowMode : null,
    afterblow_valuation: ab ? p.grammar.afterblowValuation : null,
    afterblow_fixed_value: ab ? p.grammar.afterblowFixedValue : null,
    is_default: false,
    is_system: false,
    owner_organization_id: p.ownerOrganizationId,
    public_visibility: false,
    created_by_user_id: p.actorUserId,
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
    // Only a ruleset that says `false` loses the ceiling. Anything silent keeps
    // it, which is what every ruleset did before the capability existed.
    hasMaxDoubles: metadata?.hasMaxDoubles !== false,
  };
}
