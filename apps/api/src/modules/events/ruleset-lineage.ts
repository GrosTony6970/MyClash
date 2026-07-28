/**
 * apps/api/src/modules/events/ruleset-lineage.ts
 *
 * THE server-side owner of "how does this coded fork diverge from the built-in
 * it reuses" — the three-bucket lineage lamps (grammar · end conditions ·
 * ranking) every organiser-facing surface renders.
 *
 * Why this exists at all: the lamps must agree with the content-hash
 * fingerprint about what a "change" is (see packages/rulesets/src/lineage.ts).
 * That means BOTH sides have to be projected from their EFFECTIVE behaviour —
 * a ruleset's resolved grammar plus its resolved config — never from the raw
 * columns. The raw columns are not comparable: a built-in's `tf_config` holds
 * only the super-admin OVERRIDES (migration 0053 seeds TF_v1's without
 * `tournamentPolicy`; Generic_PointsCap has no seed at all), while a fork's
 * `tf_config` is a tournament's fully-parsed `ruleset_config` and therefore
 * always carries every schema default. Diffing those two directly reports a
 * ranking change — and fires the "placings no longer match {base}" guardrail —
 * on a fork that scores identically. That was the live bug this module retires.
 *
 * Everything routes through `resolveRulesetGrammar` / `resolveRulesetConfigDefaults`
 * (or their extracted pure halves), which is the same projection the re-pin
 * ceremony uses, so the lamps on a card, in a table, on the edit page and in the
 * re-pin dialog are all the same computation.
 */
import {
  diffRulesetBuckets,
  projectRulesetBuckets,
  type BucketDiff,
  type RulesetBucketInputs,
} from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';
import { resolveRulesetConfigDefaults, resolveRulesetGrammar } from './ruleset-defaults';
import {
  codedConfigFromRow,
  CUSTOM_RULESET_CONFIG_COLUMNS,
  CUSTOM_RULESET_GRAMMAR_COLUMNS,
  grammarFromRow,
  normalizeRulesetVersion,
  type CustomRulesetConfigRow,
  type CustomRulesetGrammarRow,
} from './ruleset-row-projection';

/** What a lineage-bearing surface renders: the base's display NAME (never a
 *  code or a UUID) plus the computed per-bucket diff. */
export interface RulesetLineage {
  base: string;
  diff: BucketDiff;
}

/** The `custom_rulesets` shape {@link describeForkLineage} needs per row. A list
 *  read that wants lineage must select these columns. */
export type LineageRow = CustomRulesetGrammarRow &
  CustomRulesetConfigRow & {
    id: string;
    code: string;
  };

/** The extra columns a lean list projection must add to compute lineage —
 *  assembled from the two projections' own column sets so a field can never be
 *  added to a projection and forgotten in a select. */
export const RULESET_LINEAGE_COLUMNS = `${CUSTOM_RULESET_CONFIG_COLUMNS}, ${CUSTOM_RULESET_GRAMMAR_COLUMNS}`;

/** Project a ruleset row into the bucket inputs — grammar from its own columns,
 *  config from the base-merged effective config. Zero queries. */
export function bucketInputsFromRow(row: LineageRow): RulesetBucketInputs {
  const grammar = grammarFromRow(row);
  return projectRulesetBuckets({
    targets: grammar.targets,
    has_afterblow: grammar.hasAfterblow,
    afterblow_valuation: grammar.afterblowValuation,
    afterblow_fixed_value: grammar.afterblowFixedValue,
    tf_config: codedConfigFromRow(row),
  });
}

/**
 * Project a ruleset identified by (code, version) into the bucket inputs. Used
 * for the BASE side, where we hold only a code: built-ins short-circuit to the
 * registry for grammar and to the static defaults (⊕ stored overrides) for
 * config, so this costs at most one read.
 */
export async function bucketInputsForCode(
  supabase: SupabaseService,
  code: string,
  version: string,
): Promise<RulesetBucketInputs> {
  const [grammar, config] = await Promise.all([
    resolveRulesetGrammar(supabase, code, version),
    resolveRulesetConfigDefaults(supabase, code, version),
  ]);
  return projectRulesetBuckets({
    targets: grammar.targets,
    has_afterblow: grammar.hasAfterblow,
    afterblow_valuation: grammar.afterblowValuation,
    afterblow_fixed_value: grammar.afterblowFixedValue,
    tf_config: config,
  });
}

/**
 * Lineage for a whole list of rulesets, keyed by row id.
 *
 * Batched on purpose: the distinct base codes across a list are one or two
 * (the built-ins), so each base is projected and named exactly ONCE no matter
 * how long the list is — a list read must not become an N+1.
 *
 * Rows with no `base_code` (built-ins, formula rulesets authored from scratch)
 * map to `null`: they reuse nothing, so there is no lineage to show.
 */
export async function describeForkLineage(
  supabase: SupabaseService,
  rows: readonly LineageRow[],
): Promise<Map<string, RulesetLineage | null>> {
  const out = new Map<string, RulesetLineage | null>();
  for (const row of rows) out.set(row.id, null);

  const forks = rows.filter((row) => row.base_code);
  if (forks.length === 0) return out;

  const baseKeys = new Map<string, { code: string; version: string }>();
  for (const fork of forks) {
    const code = fork.base_code as string;
    const version = normalizeRulesetVersion(fork.base_version ?? '1.0.0');
    baseKeys.set(`${code}:${version}`, { code, version });
  }

  // Names first, and they gate the whole computation. `resolveRulesetGrammar`
  // answers an unknown code with a FALLBACK grammar rather than an absence, so
  // projecting an unresolvable base would silently diff against a fabricated
  // baseline — lamps that describe a ruleset nobody has. A base with no row is
  // no lineage. It also means a lamp is never headed by a bare code.
  const names = await resolveBaseNames(
    supabase,
    [...baseKeys.values()].map((base) => base.code),
  );
  const bases = new Map<string, RulesetBucketInputs>();
  await Promise.all(
    [...baseKeys].map(async ([key, base]) => {
      if (!names.has(base.code)) return;
      bases.set(key, await bucketInputsForCode(supabase, base.code, base.version));
    }),
  );

  for (const fork of forks) {
    const code = fork.base_code as string;
    const key = `${code}:${normalizeRulesetVersion(fork.base_version ?? '1.0.0')}`;
    const base = bases.get(key);
    const name = names.get(code);
    if (!base || !name) continue; // unresolvable base → no lamps, never a throw
    out.set(fork.id, { base: name, diff: diffRulesetBuckets(base, bucketInputsFromRow(fork)) });
  }
  return out;
}

/**
 * Display names for the base codes, in one query.
 *
 * Deliberately NOT filtered on `status`: a delisted ruleset stays resolvable
 * forever for anything pinned to it, so an archived base must still name its
 * forks' lamps rather than silently blanking them.
 */
async function resolveBaseNames(
  supabase: SupabaseService,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (codes.length === 0) return names;
  const { data } = await supabase.service
    .from('custom_rulesets')
    .select('code, name')
    .in('code', [...new Set(codes)]);
  for (const row of (data ?? []) as Array<{ code: string; name: string }>) {
    names.set(row.code, row.name);
  }
  return names;
}
