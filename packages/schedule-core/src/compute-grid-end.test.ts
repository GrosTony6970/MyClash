import { describe, expect, it } from 'vitest';
import { computeGridEndSlot } from './compute-grid-end';

// Axis is 08:00 + 5-min slots. 144 = 20:00 (default floor), 192 = midnight.
describe('computeGridEndSlot', () => {
  it('floors at the default end (20:00 = slot 144) with no content', () => {
    expect(computeGridEndSlot({ blockEndSlots: [], breakEndSlots: [], dayEndHHMM: null })).toBe(
      144,
    );
  });

  it('extends to the next hour past the latest block (21:30 → 22:00 = 168)', () => {
    // 21:30 = slot 162.
    expect(computeGridEndSlot({ blockEndSlots: [162], breakEndSlots: [], dayEndHHMM: null })).toBe(
      168,
    );
  });

  it('lets later content win over an earlier configured day-end', () => {
    // dayEnd 19:00 (slot 132) but a block runs to 20:30 (slot 150) → round to 21:00 = 156.
    expect(
      computeGridEndSlot({ blockEndSlots: [150], breakEndSlots: [], dayEndHHMM: '19:00' }),
    ).toBe(156);
  });

  it('stays at the default when all content is below it', () => {
    expect(
      computeGridEndSlot({ blockEndSlots: [120], breakEndSlots: [108], dayEndHHMM: '17:00' }),
    ).toBe(144);
  });

  it('rounds a sub-hour overflow up to the next hour boundary', () => {
    expect(computeGridEndSlot({ blockEndSlots: [145], breakEndSlots: [], dayEndHHMM: null })).toBe(
      156,
    );
  });

  it('clamps an absurd day-end to midnight (slot 192)', () => {
    expect(computeGridEndSlot({ blockEndSlots: [], breakEndSlots: [], dayEndHHMM: '30:00' })).toBe(
      192,
    );
  });
});
