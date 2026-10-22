import { describe, expect, it } from 'vitest';
import { TFv1DefaultConfig } from '@myclash/rulesets';

/**
 * Migration 0245 removes from TF_v1's row each value equal to the engine's (operator rulings 61
 * and 135): its literal `tf_v1_engine_copies` holds those values, and a leaf it holds wrong would be
 * kept as if a platform admin had chosen it. This compares the literal with `TFv1DefaultConfig`,
 * AS OF 0245: a later change of the engine's defaults freezes this test's expected side to today's
 * values; it never edits 0245, whose checksum is in the deploy ledger.
 *
 * Loaded by `await import()`, as `penalties/forfeit-rules.migration-parity.test.ts` does: a
 * CommonJS test cannot import the `.mjs` extractor statically. The extractor finds the migration by
 * the tag on its line, not its number.
 */
const extractor = () => import('../../../../../../scripts/lib/migration-literal.mjs');

const MATCH_FORMAT_LEAVES = [
  'pointCap',
  'scoringDirection',
  'timerMode',
  'timeLimitsSeconds',
  'softClockLimitSeconds',
  'maxDoubleHits',
  'maxDoubleHitOutcome',
] as const;

describe('migration 0245’s engine values', () => {
  it('are TF_v1’s own defaults, leaf by leaf', async () => {
    const { migrationLiteral } = await extractor();
    const { value } = migrationLiteral('tf_v1_engine_copies');

    expect(value).toEqual({
      winBonus: TFv1DefaultConfig.winBonus,
      doublePenaltyFormula: TFv1DefaultConfig.doublePenaltyFormula,
      targetValues: TFv1DefaultConfig.targetValues,
      targets: TFv1DefaultConfig.targets,
      matchFormat: Object.fromEntries(
        MATCH_FORMAT_LEAVES.map((leaf) => [leaf, TFv1DefaultConfig.matchFormat[leaf]]),
      ),
    });
  });
});
