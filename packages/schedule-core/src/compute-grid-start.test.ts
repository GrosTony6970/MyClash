import { describe, expect, it } from 'vitest';
import { computeGridStartHour } from './compute-grid-start';
import { DEFAULT_GRID_START_HOUR } from './schedule-grid-geometry';

const h = (hour: number, minute = 0) => hour * 60 + minute;

describe('computeGridStartHour', () => {
  it('keeps the default for an empty day', () => {
    expect(computeGridStartHour([])).toBe(DEFAULT_GRID_START_HOUR);
  });

  it('keeps the default when nothing starts before it', () => {
    expect(computeGridStartHour([h(9), h(13), h(18, 30)])).toBe(DEFAULT_GRID_START_HOUR);
  });

  /**
   * The regression. A 07:30 gear-check block was clamped to slot 0 by both
   * converters, so it RENDERED at 08:00 — and dragging anything near it wrote
   * that wrong time back. Nothing floors such a block on the way in: the
   * planner's day-start field accepts any HH:MM.
   */
  it('moves the origin back for an early block', () => {
    expect(computeGridStartHour([h(7, 30), h(9)])).toBe(7);
  });

  it('rounds down to a whole hour, so the hourly ruler stays on the hour', () => {
    expect(computeGridStartHour([h(6, 45)])).toBe(6);
  });

  it('takes the earliest of several', () => {
    expect(computeGridStartHour([h(9), h(6, 15), h(7)])).toBe(6);
  });

  it('never goes below midnight', () => {
    expect(computeGridStartHour([h(0, 10)])).toBe(0);
  });

  it('ignores values that are not finite', () => {
    expect(computeGridStartHour([Number.NaN, h(7)])).toBe(7);
  });
});
