import { describe, expect, it } from 'vitest';
import { liceSpanFromDelta, respaceMatchesEvenly } from './lice-span';

describe('liceSpanFromDelta', () => {
  it('relocates a pool block to another single lice', () => {
    expect(
      liceSpanFromDelta({ kind: 'pool', liceIndices: [1], deltaCols: 1, liceCount: 4 }),
    ).toEqual([2]);
  });
  it('clamps a pool relocate at the left edge', () => {
    expect(
      liceSpanFromDelta({ kind: 'pool', liceIndices: [0], deltaCols: -1, liceCount: 4 }),
    ).toEqual([0]);
  });
  it('clamps a pool relocate at the right edge', () => {
    expect(
      liceSpanFromDelta({ kind: 'pool', liceIndices: [0], deltaCols: 99, liceCount: 4 }),
    ).toEqual([3]);
  });
  it('widens a bracket block by one lice', () => {
    expect(
      liceSpanFromDelta({ kind: 'bracket', liceIndices: [1, 2], deltaCols: 1, liceCount: 4 }),
    ).toEqual([1, 2, 3]);
  });
  it('narrows a bracket block by one lice', () => {
    expect(
      liceSpanFromDelta({ kind: 'bracket', liceIndices: [1, 2, 3], deltaCols: -1, liceCount: 4 }),
    ).toEqual([1, 2]);
  });
  it('never narrows a bracket below its start lice', () => {
    expect(
      liceSpanFromDelta({ kind: 'bracket', liceIndices: [1, 2], deltaCols: -5, liceCount: 4 }),
    ).toEqual([1]);
  });
  it('clamps a bracket widen at the last lice', () => {
    expect(
      liceSpanFromDelta({ kind: 'bracket', liceIndices: [2, 3], deltaCols: 5, liceCount: 4 }),
    ).toEqual([2, 3]);
  });
});

describe('respaceMatchesEvenly', () => {
  it('puts a single match at the start', () => {
    expect(respaceMatchesEvenly({ startSlot: 10, endSlot: 20, count: 1 })).toEqual([10]);
  });
  it('spreads matches evenly across the span', () => {
    expect(respaceMatchesEvenly({ startSlot: 0, endSlot: 16, count: 4 })).toEqual([0, 4, 8, 12]);
  });
  it('stacks all at the start when the span is empty', () => {
    expect(respaceMatchesEvenly({ startSlot: 5, endSlot: 5, count: 3 })).toEqual([5, 5, 5]);
  });
  it('floors non-divisible steps and stays monotonic', () => {
    const slots = respaceMatchesEvenly({ startSlot: 0, endSlot: 10, count: 3 });
    expect(slots).toEqual([0, 3, 6]);
    for (let i = 1; i < slots.length; i++) expect(slots[i]!).toBeGreaterThanOrEqual(slots[i - 1]!);
  });
});
