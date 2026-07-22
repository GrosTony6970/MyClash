/**
 * Ruleset lineage: how a fork diverges from the ruleset it was forked from,
 * per the three-bucket model (grammar · end conditions · ranking).
 *
 * Computed by DIFFING, never self-declared — a fork cannot claim to be
 * TF_v1-compatible while scoring differently. The `ranking` bucket is the one
 * that changes results, so `rankingCompatible` drives the guardrail
 * ("this breaks {base} ranking compatibility").
 *
 * The buckets are a FAITHFUL SUBSET of the content-hash's effective-scoring
 * canonical (see content-hash.ts): the same fields decide a "change" here as
 * decide the fingerprint, so two rulesets with the same content hash light no
 * lamp and any hash difference lights at least one. Concretely that means:
 *   - grammar compares targets order-insensitively (canonicalizeGrammar sorts);
 *   - endConditions normalizes through the SAME scorer normalizer the hash uses
 *     (defaults + legacy aliases resolved), so absent ≡ default and firstToPoints
 *     ≡ pointCap;
 *   - ranking folds in forfeitPolicy + tournamentPolicy (both re-rank results and
 *     both sit in the coded canonical), not just winBonus + doublePenaltyFormula.
 * `afterblowMode` is deliberately NOT a bucket: it lives on the tournament
 * (scoring_config_json), not on a ruleset row, so it is not part of a ruleset's
 * lineage. The ruleset-level afterblow shape (has/valuation/fixed) IS in grammar.
 *
 * Inputs are structural (plain objects), not `@myclash/types` shapes, so this
 * stays in the dependency-free package. The caller projects each side's config
 * into these fields (a base_code fork's overrides live in tf_config + the
 * grammar columns; the base's come from its registry defaults).
 */
import { normalizeMatchFormatConfig } from './match-format';

export type BucketStatus = 'unchanged' | 'changed';

export interface RulesetBucketInputs {
  // grammar — what an exchange can be and is worth
  targets: ReadonlyArray<{ name: string; value: number }> | null;
  hasAfterblow: boolean;
  afterblowValuation: 'fixed' | 'weighted' | null;
  afterblowFixedValue: number | null;
  // end conditions — when/how a bout ends
  matchFormat: Record<string, unknown> | null;
  // ranking — what a result is worth (all four re-rank placings)
  winBonus: number | null;
  doublePenaltyFormula: unknown;
  forfeitPolicy: unknown;
  tournamentPolicy: unknown;
}

export interface BucketDiff {
  grammar: BucketStatus;
  endConditions: BucketStatus;
  ranking: BucketStatus;
  /** True when the ranking bucket is unchanged — scores still compare like the
   *  base. False is what fires the "breaks {base} ranking compatibility" guard. */
  rankingCompatible: boolean;
}

/** Order-sensitive deep equality over JSON-shaped values (no functions/dates). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const bArr = b as unknown[];
    const aList = a as unknown[];
    if (aList.length !== bArr.length) return false;
    return aList.every((x, i) => deepEqual(x, bArr[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const statusOf = (equal: boolean): BucketStatus => (equal ? 'unchanged' : 'changed');

/** Targets sorted by name — order is the pad's display layout, not behaviour, so
 *  a pure reorder must not light the grammar lamp (mirrors canonicalizeGrammar). */
function sortedTargets(
  targets: ReadonlyArray<{ name: string; value: number }> | null,
): ReadonlyArray<{ name: string; value: number }> | null {
  if (!targets) return null;
  return [...targets]
    .map((target) => ({ name: target.name, value: target.value }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Per-bucket divergence of `fork` from its `base`. Both sides must already be
 * projected into `RulesetBucketInputs`; this only compares.
 */
export function diffRulesetBuckets(
  base: RulesetBucketInputs,
  fork: RulesetBucketInputs,
): BucketDiff {
  const grammar = statusOf(
    deepEqual(sortedTargets(base.targets), sortedTargets(fork.targets)) &&
      base.hasAfterblow === fork.hasAfterblow &&
      base.afterblowValuation === fork.afterblowValuation &&
      base.afterblowFixedValue === fork.afterblowFixedValue,
  );
  const endConditions = statusOf(deepEqual(base.matchFormat, fork.matchFormat));
  const ranking = statusOf(
    base.winBonus === fork.winBonus &&
      deepEqual(base.doublePenaltyFormula, fork.doublePenaltyFormula) &&
      deepEqual(base.forfeitPolicy, fork.forfeitPolicy) &&
      deepEqual(base.tournamentPolicy, fork.tournamentPolicy),
  );
  return { grammar, endConditions, ranking, rankingCompatible: ranking === 'unchanged' };
}

/**
 * A coded ruleset's stored shape, as far as bucket projection cares: its grammar
 * lives in first-class (snake_case) columns and its ranking + end-condition
 * fields live in `tf_config`. Kept as a loose structural record (not a
 * `@myclash/types` shape) so this package stays dependency-free — both the
 * web-admin lineage lamps and the server-side re-pin audit project their DB rows
 * into it.
 */
export interface RulesetBucketRow {
  targets?: ReadonlyArray<{ name: string; value: number }> | null;
  has_afterblow?: boolean | null;
  afterblow_valuation?: 'fixed' | 'weighted' | null;
  afterblow_fixed_value?: number | null;
  tf_config?: Record<string, unknown> | null;
}

/**
 * Normalize the end-condition config through the SAME normalizer the scorer and
 * the content-hash use, so a base and a fork compare over the identical shape
 * (defaults filled, legacy aliases resolved). A stored config is validated at
 * authoring, but a corrupt one must not crash the lamp: an out-of-domain value
 * throws inside the normalizer, so degrade to the default shape rather than
 * propagating (`normalizeMatchFormatConfig({})` never throws).
 */
function normalizeEndConditions(
  mf: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  try {
    return normalizeMatchFormatConfig(mf ?? {}) as unknown as Record<string, unknown>;
  } catch {
    return normalizeMatchFormatConfig({}) as unknown as Record<string, unknown>;
  }
}

/**
 * Project a coded ruleset row (a fork or its base) into the lineage bucket
 * inputs, ready for {@link diffRulesetBuckets}. Grammar comes from the
 * first-class columns; ranking + end conditions come from `tf_config`.
 */
export function projectRulesetBuckets(row: RulesetBucketRow): RulesetBucketInputs {
  const tf = (row.tf_config ?? {}) as {
    winBonus?: number;
    matchFormat?: Record<string, unknown>;
    doublePenaltyFormula?: unknown;
    forfeitPolicy?: unknown;
    tournamentPolicy?: unknown;
  };
  return {
    targets: row.targets ?? null,
    hasAfterblow: row.has_afterblow ?? false,
    afterblowValuation: row.afterblow_valuation ?? null,
    afterblowFixedValue: row.afterblow_fixed_value ?? null,
    matchFormat: normalizeEndConditions(tf.matchFormat),
    winBonus: tf.winBonus ?? null,
    doublePenaltyFormula: tf.doublePenaltyFormula ?? null,
    forfeitPolicy: tf.forfeitPolicy ?? null,
    tournamentPolicy: tf.tournamentPolicy ?? null,
  };
}
