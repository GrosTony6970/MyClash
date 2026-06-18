import { describe, expect, it } from 'vitest';
import { liceUtilizationPct } from './lice-utilization';

describe('liceUtilizationPct', () => {
  const items = [
    { liceIds: ['l1'], startSlot: 0, endSlot: 24 }, // 24 slots on l1
    { liceIds: ['l1', 'l2'], startSlot: 30, endSlot: 36 }, // 6 slots on l1 + l2
  ];

  it('is 0 on an empty lice', () => {
    expect(liceUtilizationPct(items, 'l9', 144)).toBe(0);
  });

  it('sums the slot-spans of blocks on the lice as a % of the grid', () => {
    // l1: 24 + 6 = 30 of 144 → 21%.
    expect(liceUtilizationPct(items, 'l1', 144)).toBe(21);
    // l2: 6 of 144 → 4%.
    expect(liceUtilizationPct(items, 'l2', 144)).toBe(4);
  });

  it('clamps to 100 and guards a non-positive grid', () => {
    expect(liceUtilizationPct([{ liceIds: ['l1'], startSlot: 0, endSlot: 500 }], 'l1', 144)).toBe(
      100,
    );
    expect(liceUtilizationPct(items, 'l1', 0)).toBe(0);
  });
});
