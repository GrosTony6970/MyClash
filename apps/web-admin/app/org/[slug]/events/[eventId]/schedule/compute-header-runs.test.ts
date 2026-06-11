import { describe, expect, it } from 'vitest';
import { computeHeaderRuns, type HeaderRunItem } from './compute-header-runs';

const item = (
  id: string,
  key: string,
  slot: number,
  over: Partial<HeaderRunItem> = {},
): HeaderRunItem => ({ id, key, liceIndex: 0, slot, span: 2, ...over });

describe('computeHeaderRuns', () => {
  it('folds back-to-back same-key matches on one lice into a single run', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0),
      item('m2', 'pool-1', 2),
      item('m3', 'pool-1', 4),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      key: 'pool-1',
      liceIndex: 0,
      startSlot: 0,
      endSlot: 6,
      matchIds: ['m1', 'm2', 'm3'],
    });
  });

  it('splits the run when a time gap separates same-key matches', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0),
      item('m2', 'pool-1', 2),
      item('m3', 'pool-1', 10),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs[0]!.matchIds).toEqual(['m1', 'm2']);
    expect(runs[1]).toMatchObject({ startSlot: 10, endSlot: 12, matchIds: ['m3'] });
  });

  it('splits around a different-key match wedged into the run', () => {
    const runs = computeHeaderRuns([
      item('a1', 'LSW|SF', 0),
      item('other', 'LSW|F', 2),
      item('a2', 'LSW|SF', 4),
    ]);

    expect(runs.map((r) => r.key)).toEqual(['LSW|SF', 'LSW|F', 'LSW|SF']);
    expect(runs.map((r) => r.matchIds)).toEqual([['a1'], ['other'], ['a2']]);
  });

  it('keeps one run per lice for the same key', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0, { liceIndex: 0 }),
      item('m2', 'pool-1', 0, { liceIndex: 1 }),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.liceIndex)).toEqual([0, 1]);
  });

  it('extends the run through overlapping same-key matches (conflict layout)', () => {
    const runs = computeHeaderRuns([item('m1', 'pool-1', 0, { span: 4 }), item('m2', 'pool-1', 2)]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.endSlot).toBe(4);
  });
});
