import { describe, expect, it } from 'vitest';
import { chooseAutoPlacement, distributeGroups } from './auto-place';

describe('chooseAutoPlacement', () => {
  it('returns null when there are no lices', () => {
    expect(chooseAutoPlacement([], 12)).toBeNull();
  });
  it('places on the first lice at the day start when all are empty', () => {
    expect(
      chooseAutoPlacement(
        [
          { liceId: 'l1', lastEndSlot: 12 },
          { liceId: 'l2', lastEndSlot: 12 },
        ],
        12,
      ),
    ).toEqual({ liceId: 'l1', startSlot: 12 });
  });
  it('picks the least-loaded lice', () => {
    expect(
      chooseAutoPlacement(
        [
          { liceId: 'l1', lastEndSlot: 40 },
          { liceId: 'l2', lastEndSlot: 20 },
        ],
        12,
      ),
    ).toEqual({ liceId: 'l2', startSlot: 20 });
  });
  it('floors the start at the day start for an under-loaded lice', () => {
    expect(chooseAutoPlacement([{ liceId: 'l1', lastEndSlot: 4 }], 12)).toEqual({
      liceId: 'l1',
      startSlot: 12,
    });
  });
});

describe('distributeGroups', () => {
  it('spreads two groups across two empty lices, one each', () => {
    const out = distributeGroups({
      groups: [
        { key: 'A', spanSlots: 6 },
        { key: 'B', spanSlots: 6 },
      ],
      loads: [
        { liceId: 'l1', lastEndSlot: 12 },
        { liceId: 'l2', lastEndSlot: 12 },
      ],
      dayStartSlot: 12,
    });
    expect(out).toEqual([
      { key: 'A', liceId: 'l1', startSlot: 12 },
      { key: 'B', liceId: 'l2', startSlot: 12 },
    ]);
  });
  it('stacks groups on a single lice', () => {
    const out = distributeGroups({
      groups: [
        { key: 'A', spanSlots: 6 },
        { key: 'B', spanSlots: 4 },
      ],
      loads: [{ liceId: 'l1', lastEndSlot: 12 }],
      dayStartSlot: 12,
    });
    expect(out).toEqual([
      { key: 'A', liceId: 'l1', startSlot: 12 },
      { key: 'B', liceId: 'l1', startSlot: 18 },
    ]);
  });
  it('respects pre-existing loads', () => {
    const out = distributeGroups({
      groups: [{ key: 'A', spanSlots: 6 }],
      loads: [
        { liceId: 'l1', lastEndSlot: 100 },
        { liceId: 'l2', lastEndSlot: 12 },
      ],
      dayStartSlot: 12,
    });
    expect(out).toEqual([{ key: 'A', liceId: 'l2', startSlot: 12 }]);
  });
  it('preserves group order in the output', () => {
    const out = distributeGroups({
      groups: [
        { key: 'first', spanSlots: 2 },
        { key: 'second', spanSlots: 2 },
      ],
      loads: [{ liceId: 'l1', lastEndSlot: 12 }],
      dayStartSlot: 12,
    });
    expect(out.map((p) => p.key)).toEqual(['first', 'second']);
  });
});
