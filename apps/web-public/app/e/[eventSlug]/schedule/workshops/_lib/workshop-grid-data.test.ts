import { describe, expect, it } from 'vitest';
import { computeGridEndSlot, DEFAULT_GRID_END_HOUR, GRID_START_HOUR } from '@myclash/schedule-core';
import { dayEndSlot, deriveStartHour } from './workshop-grid-window';

const TZ = 'Europe/Paris';

describe('deriveStartHour', () => {
  it('falls back to the board default with no content', () => {
    expect(deriveStartHour([], [], TZ)).toBe(GRID_START_HOUR);
  });

  it('never starts LATER than the default, even when the day begins at 10:00', () => {
    expect(deriveStartHour(['2027-05-22T08:00:00Z'], [], TZ)).toBe(GRID_START_HOUR);
  });

  it('pulls the axis earlier for a session before the default hour', () => {
    // 05:30Z is 07:30 in Paris (CEST, +02:00).
    expect(deriveStartHour(['2027-05-22T05:30:00Z'], [], TZ)).toBe(7);
  });

  it('resolves the hour in the EVENT zone, not UTC', () => {
    // The same instant is 07:30 in Paris (CEST) but 06:30 in London (BST) —
    // the tz argument decides, and neither answer is the raw UTC 05:30.
    expect(deriveStartHour(['2027-05-22T05:30:00Z'], [], 'Europe/London')).toBe(6);
  });

  it('honours an early break bar', () => {
    expect(deriveStartHour([], ['06:30'], TZ)).toBe(6);
  });

  it('takes the earliest of sessions and breaks', () => {
    expect(deriveStartHour(['2027-05-22T05:30:00Z'], ['06:30'], TZ)).toBe(6);
  });

  it('ignores unparseable instants rather than collapsing to 0', () => {
    expect(deriveStartHour(['not-a-date'], [], TZ)).toBe(GRID_START_HOUR);
  });
});

describe('dayEndSlot', () => {
  it('floors at the default end hour', () => {
    // 08:00 → 20:00 is 12h = 144 slots.
    expect(dayEndSlot(GRID_START_HOUR, [])).toBe(144);
  });

  it('grows to cover a late block, rounded up to a whole hour', () => {
    // A block ending at slot 150 (20:30) extends the axis to 21:00 = 156.
    expect(dayEndSlot(GRID_START_HOUR, [150])).toBe(156);
  });

  it('clamps at midnight', () => {
    expect(dayEndSlot(GRID_START_HOUR, [10_000])).toBe((24 - GRID_START_HOUR) * 12);
  });

  it('accounts for an earlier start hour in the floor', () => {
    // 07:00 → 20:00 is 13h = 156 slots.
    expect(dayEndSlot(7, [])).toBe((DEFAULT_GRID_END_HOUR - 7) * 12);
  });

  it('agrees with computeGridEndSlot when the axis starts at the default hour', () => {
    // Guards the deliberate duplication: computeGridEndSlot hardcodes
    // GRID_START_HOUR as its origin, so it is only equivalent in this case.
    for (const latest of [0, 100, 144, 150, 200]) {
      expect(dayEndSlot(GRID_START_HOUR, [latest])).toBe(
        computeGridEndSlot({ blockEndSlots: [latest], breakEndSlots: [], dayEndHHMM: null }),
      );
    }
  });
});
