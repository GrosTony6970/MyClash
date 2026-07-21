/**
 * Ruleset lineage: how a fork diverges from the ruleset it was forked from,
 * per the three-bucket model (grammar · end conditions · ranking).
 *
 * Computed by DIFFING, never self-declared — a fork cannot claim to be
 * TF_v1-compatible while scoring differently. The `ranking` bucket is the one
 * that changes results, so `rankingCompatible` drives the guardrail
 * ("this breaks {base} ranking compatibility").
 *
 * Inputs are structural (plain objects), not `@myclash/types` shapes, so this
 * stays in the dependency-free package. The caller projects each side's config
 * into these fields (a base_code fork's overrides live in tf_config + the
 * grammar columns; the base's come from its registry defaults).
 */

export type BucketStatus = 'unchanged' | 'changed';

export interface RulesetBucketInputs {
  // grammar — what an exchange can be and is worth
  targets: ReadonlyArray<{ name: string; value: number }> | null;
  hasAfterblow: boolean;
  afterblowValuation: 'fixed' | 'weighted' | null;
  afterblowFixedValue: number | null;
  // end conditions — when/how a bout ends
  matchFormat: Record<string, unknown> | null;
  // ranking — what a result is worth
  winBonus: number | null;
  doublePenaltyFormula: unknown;
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

/**
 * Per-bucket divergence of `fork` from its `base`. Both sides must already be
 * projected into `RulesetBucketInputs`; this only compares.
 */
export function diffRulesetBuckets(
  base: RulesetBucketInputs,
  fork: RulesetBucketInputs,
): BucketDiff {
  const grammar = statusOf(
    deepEqual(base.targets, fork.targets) &&
      base.hasAfterblow === fork.hasAfterblow &&
      base.afterblowValuation === fork.afterblowValuation &&
      base.afterblowFixedValue === fork.afterblowFixedValue,
  );
  const endConditions = statusOf(deepEqual(base.matchFormat, fork.matchFormat));
  const ranking = statusOf(
    base.winBonus === fork.winBonus &&
      deepEqual(base.doublePenaltyFormula, fork.doublePenaltyFormula),
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
 * Pull the end-condition fields into a fixed key set so a base and a fork compare
 * over the same shape. Without this, a field the fork's config carries but the
 * base's older `tf_config` seed lacks (e.g. `bestOf`) reads as a change on every
 * fork, because the bucket diff is key-count sensitive.
 */
export function normalizeMatchFormat(
  mf: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const m = mf ?? {};
  return {
    pointCap: m['pointCap'] ?? null,
    scoringDirection: m['scoringDirection'] ?? null,
    maxDoubleHits: m['maxDoubleHits'] ?? null,
    timeLimitsSeconds: m['timeLimitsSeconds'] ?? null,
    softClockLimitSeconds: m['softClockLimitSeconds'] ?? null,
    bestOf: m['bestOf'] ?? null,
  };
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
  };
  return {
    targets: row.targets ?? null,
    hasAfterblow: row.has_afterblow ?? false,
    afterblowValuation: row.afterblow_valuation ?? null,
    afterblowFixedValue: row.afterblow_fixed_value ?? null,
    matchFormat: normalizeMatchFormat(tf.matchFormat),
    winBonus: tf.winBonus ?? null,
    doublePenaltyFormula: tf.doublePenaltyFormula ?? null,
  };
}
