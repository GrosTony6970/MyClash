import { describe, expect, it } from 'vitest';
import { mergeScores, type MergeableMatch, type MergeablePool } from './match-scores-merge';

// Test fixture type — adds the pass-through `lice_id` field so we can
// verify it survives a score merge. The helper is generic so callers
// can mix in any extra fields.
interface FixtureMatch extends MergeableMatch {
  lice_id?: string | null;
}

function pool(matches: FixtureMatch[]): MergeablePool<FixtureMatch> {
  return { poolId: 'pool-1', poolName: 'Pool 1', matches };
}

describe('mergeScores', () => {
  it('rewrites a row whose score changed', () => {
    const pools = [
      pool([
        { id: 'm-1', status: 'pending', red_score: null, blue_score: null, lice_id: 'lice-a' },
      ]),
    ];

    const merged = mergeScores(pools, [
      { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
    ]);

    expect(merged[0]!.matches[0]).toMatchObject({
      id: 'm-1',
      status: 'completed',
      red_score: 5,
      blue_score: 3,
      // unrelated fields pass through unchanged
      lice_id: 'lice-a',
    });
  });

  it('preserves object identity on rows whose score did not change', () => {
    // This is the property that lets React's reconciler skip the row,
    // which is what keeps open <select> dropdowns open across a poll.
    const unchanged = {
      id: 'm-1',
      status: 'completed',
      red_score: 5,
      blue_score: 3,
      lice_id: 'lice-a',
    };
    const pools = [pool([unchanged])];

    const merged = mergeScores(pools, [
      { id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 },
    ]);

    expect(merged[0]!.matches[0]).toBe(unchanged); // identity, not equality
    expect(merged[0]).toBe(pools[0]); // pool identity also preserved
  });

  it('ignores updates whose id is not in the pool', () => {
    const original = pool([{ id: 'm-1', status: 'pending', red_score: null, blue_score: null }]);
    const merged = mergeScores(
      [original],
      [{ id: 'm-ghost', status: 'completed', red_score: 5, blue_score: 3 }],
    );
    expect(merged[0]).toBe(original); // no mutation, same reference
  });

  it('returns the original array when there are no updates', () => {
    const pools = [pool([])];
    expect(mergeScores(pools, [])).toBe(pools);
  });

  it('handles a mix of changed and unchanged rows in the same pool', () => {
    const stableRow = { id: 'm-1', status: 'pending', red_score: null, blue_score: null };
    const changingRow = { id: 'm-2', status: 'pending', red_score: null, blue_score: null };
    const pools = [pool([stableRow, changingRow])];

    const merged = mergeScores(pools, [
      { id: 'm-1', status: 'pending', red_score: null, blue_score: null },
      { id: 'm-2', status: 'completed', red_score: 5, blue_score: 3 },
    ]);

    // Stable row keeps identity; changing row is rewritten.
    expect(merged[0]!.matches[0]).toBe(stableRow);
    expect(merged[0]!.matches[1]).not.toBe(changingRow);
    expect(merged[0]!.matches[1]!.status).toBe('completed');
  });
});
