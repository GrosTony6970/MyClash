import { describe, expect, it } from 'vitest';
import { blockSlots, programmeBlocksForDay } from './programme-block-slots';

const GRID_START = 8;

function block(over: Partial<{ dayIndex: number; startTime: string; endTime: string }> = {}) {
  return { dayIndex: 0, startTime: '09:00', endTime: '09:30', ...over };
}

describe('blockSlots', () => {
  it('places a block relative to the axis origin', () => {
    // 09:00 is one hour past an 08:00 origin = slot 12 at 5-minute slots.
    expect(blockSlots(block(), GRID_START)).toEqual({ startSlot: 12, span: 6 });
  });

  it('accepts the HH:MM:SS form Postgres returns for a TIME column', () => {
    expect(blockSlots(block({ startTime: '09:00:00', endTime: '09:30:00' }), GRID_START)).toEqual({
      startSlot: 12,
      span: 6,
    });
  });

  it('gives a zero-length block one slot so it still renders', () => {
    expect(blockSlots(block({ startTime: '09:00', endTime: '09:00' }), GRID_START).span).toBe(1);
  });

  it('follows the axis origin it is given', () => {
    // Same 09:00 block on a 07:00 axis sits two hours in.
    expect(blockSlots(block(), 7).startSlot).toBe(24);
  });
});

describe('programmeBlocksForDay', () => {
  it('keeps only the requested day', () => {
    const kept = programmeBlocksForDay(
      [block({ dayIndex: 0 }), block({ dayIndex: 1 }), block({ dayIndex: 0 })],
      0,
      GRID_START,
    );

    expect(kept).toHaveLength(2);
  });

  /**
   * The regression this module exists for. The mapping used to end with
   * `.filter(b => b.startSlot < TOTAL_SLOTS)` — 20:00 on the default axis — so
   * an evening block was removed from both views. Worse, the visible axis end
   * is computed FROM this list, so the block was dropped before it could widen
   * the axis that would have shown it.
   */
  it('keeps a block that starts after the default axis end', () => {
    const kept = programmeBlocksForDay(
      [block({ startTime: '20:30', endTime: '21:15' })],
      0,
      GRID_START,
    );

    expect(kept).toHaveLength(1);
    // 20:30 is 12.5h past an 08:00 origin = slot 150, beyond the 144 the old
    // filter cut at.
    expect(kept[0]?.startSlot).toBe(150);
  });

  it('keeps a late final that runs to the end of the evening', () => {
    const kept = programmeBlocksForDay(
      [block({ startTime: '21:00', endTime: '22:00' })],
      0,
      GRID_START,
    );

    expect(kept).toHaveLength(1);
    expect(kept[0]?.span).toBe(12);
  });

  it('preserves the given order', () => {
    const kept = programmeBlocksForDay(
      [
        block({ startTime: '14:00', endTime: '15:00' }),
        block({ startTime: '09:00', endTime: '10:00' }),
      ],
      0,
      GRID_START,
    );

    expect(kept[0]?.startTime).toBe('14:00');
    expect(kept[1]?.startTime).toBe('09:00');
  });
});
