import { describe, it, expect } from 'vitest';
import { overlapsWindow } from './date-window';

describe('overlapsWindow', () => {
  const event = { start: '2026-06-10', end: '2026-06-12' };

  it('includes an event straddling the window start', () => {
    expect(overlapsWindow(event, { from: '2026-06-12' })).toBe(true);
    expect(overlapsWindow(event, { from: '2026-06-13' })).toBe(false);
  });

  it('includes an event starting on the window end day', () => {
    expect(overlapsWindow({ start: '2026-06-20', end: null }, { to: '2026-06-20' })).toBe(true);
    expect(overlapsWindow({ start: '2026-06-21', end: null }, { to: '2026-06-20' })).toBe(false);
  });

  it('treats a null end date as a single-day event', () => {
    expect(overlapsWindow({ start: '2026-06-10', end: null }, { from: '2026-06-11' })).toBe(false);
    expect(overlapsWindow({ start: '2026-06-10', end: null }, { from: '2026-06-10' })).toBe(true);
  });

  it('includes an event that spans the whole window', () => {
    expect(
      overlapsWindow(
        { start: '2026-01-01', end: '2026-12-31' },
        { from: '2026-06-01', to: '2026-06-02' },
      ),
    ).toBe(true);
  });

  it('accepts everything when no bounds are given', () => {
    expect(overlapsWindow(event, {})).toBe(true);
    expect(overlapsWindow(event, { from: null, to: null })).toBe(true);
  });

  it('takes the last day of the calendar as a window end (no day after it to compute)', () => {
    expect(overlapsWindow({ start: '9999-12-31', end: null }, { to: '9999-12-31' })).toBe(true);
  });
});
