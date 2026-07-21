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
