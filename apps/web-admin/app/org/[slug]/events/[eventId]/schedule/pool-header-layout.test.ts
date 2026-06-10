import { describe, it, expect } from 'vitest';
import { POOL_HEADER_SPAN, rowShiftForSlot } from './pool-header-layout';

describe('rowShiftForSlot', () => {
  it('is 0 when there are no pool headers', () => {
    expect(rowShiftForSlot(10, [], POOL_HEADER_SPAN)).toBe(0);
  });

  it('shifts every slot at or after a single header by the header span', () => {
    expect(rowShiftForSlot(0, [0], 2)).toBe(2);
    expect(rowShiftForSlot(50, [0], 2)).toBe(2);
  });

  it('accumulates the span for each header at or above the slot', () => {
    // Headers start at slots 0 and 40.
    expect(rowShiftForSlot(10, [0, 40], 2)).toBe(2); // only the slot-0 header is above
    expect(rowShiftForSlot(50, [0, 40], 2)).toBe(4); // both headers are above
    expect(rowShiftForSlot(40, [0, 40], 2)).toBe(4); // the slot-40 header counts at its own slot
  });

  it('treats duplicate header start slots (pools sharing a start) as one', () => {
    // Two pools both starting at slot 0 must reserve one shared band, not two.
    expect(rowShiftForSlot(0, [0, 0], 2)).toBe(2);
    expect(rowShiftForSlot(5, [0, 0], 2)).toBe(2);
  });
});
