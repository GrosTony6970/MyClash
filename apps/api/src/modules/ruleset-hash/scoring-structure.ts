/**
 * The scoring structure of a ruleset pair: a coded engine or a club formula, and what each scores
 * with. Read by the Tournament fingerprint (`RulesetHashService`) and by the seed of a Tournament's
 * buttons (`scoringKindOf`), so the two never disagree on a pair's kind.
 */
import type { RulesetRegistry } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, unknown>;

export type ScoringStructure =
  | { kind: 'coded'; engineCode: string; engineVersion: string }
  | {
      kind: 'formula';
      scoreFormula: unknown;
      constants: Record<string, number>;
      tiebreakers: ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>;
      doublePenaltyFormula: unknown;
      decisionEdition: string | null;
    };

/** The kind of a pair's scoring structure: a coded engine or a club formula (`scoringStructureOf`). */
export async function scoringKindOf(
  supabase: SupabaseService,
  registry: RulesetRegistry,
  code: string,
  version: string,
): Promise<ScoringStructure['kind']> {
  return (await scoringStructureOf(supabase, registry, code, version)).kind;
}

/**
 * Determine the scoring definition's kind + engine/formula, mirroring
 * RulesetResolver's tiers: registry/system → coded engine token; a base_code
 * fork → its base engine; a formula ruleset → its AST (from the pinned version
 * snapshot, else the parent row).
 */
export async function scoringStructureOf(
  supabase: SupabaseService,
  registry: RulesetRegistry,
  code: string,
  version: string,
): Promise<ScoringStructure> {
  if (registry.has(code, version))
    return { kind: 'coded', engineCode: code, engineVersion: version };
  const { data, error } = await supabase.service
    .from('custom_rulesets')
    .select(
      'id, is_system, base_code, base_version, score_formula, constants, tiebreakers, double_penalty_formula, decision_edition',
    )
    .eq('code', code)
    .maybeSingle();
  // A failed read is not "no club ruleset": read as none, a club formula would be hashed and its
  // buttons seeded as a coded engine.
  if (error)
    throw new Error(
      `Ruleset ${code}@${version} was not read for its scoring structure: ${error.message}`,
    );
  const parent = data as Row | null;
  if (!parent || parent['is_system']) {
    return { kind: 'coded', engineCode: code, engineVersion: version };
  }
  if (parent['base_code']) {
    return {
      kind: 'coded',
      engineCode: parent['base_code'] as string,
      engineVersion: (parent['base_version'] as string | null) ?? '1.0.0',
    };
  }
  const snapshot = await loadScoringSnapshot(supabase, parent['id'] as string, version);
  // No published snapshot: the row itself, a draft included. The resolver
  // scores a Tournament pinned to a draft as its draft (ruling 6), so the
  // fingerprint describes that formula too.
  const def = snapshot ?? parent;
  return {
    kind: 'formula',
    scoreFormula: def['score_formula'],
    constants: (def['constants'] as Record<string, number>) ?? {},
    tiebreakers:
      (def['tiebreakers'] as ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>) ?? [],
    doublePenaltyFormula: def['double_penalty_formula'] ?? null,
    // The edition a published version keeps (0228): the formula alone is not its behaviour.
    decisionEdition: (def['decision_edition'] as string | null | undefined) ?? null,
  };
}

async function loadScoringSnapshot(
  supabase: SupabaseService,
  customRulesetId: string,
  version: string,
): Promise<Row | null> {
  const { data, error } = await supabase.service
    .from('custom_ruleset_versions')
    .select('score_formula, constants, tiebreakers, double_penalty_formula, decision_edition')
    .eq('custom_ruleset_id', customRulesetId)
    .eq('version', version)
    .maybeSingle();
  // Read as "no snapshot", the hash described the parent row: the latest version, not this one.
  if (error)
    throw new Error(`Snapshot ${version} was not read for its scoring structure: ${error.message}`);
  return (data as Row | null) ?? null;
}
