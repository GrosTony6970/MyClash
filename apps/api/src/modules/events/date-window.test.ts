import { describe, it, expect } from 'vitest';
import { nextIsoDay, overlapsWindow } from './date-window';

describe('nextIsoDay', () => {
  it('advances one day', () => {
    expect(nextIsoDay('2026-06-01')).toBe('2026-06-02');
  });

  it('rolls over a month end', () => {
    expect(nextIsoDay('2026-06-30')).toBe('2026-07-01');
    expect(nextIsoDay('2026-01-31')).toBe('2026-02-01');
  });

  it('rolls over a year end', () => {
    expect(nextIsoDay('2026-12-31')).toBe('2027-01-01');
  });

  it('handles a leap day and a non-leap February', () => {
    expect(nextIsoDay('2028-02-28')).toBe('2028-02-29');
    expect(nextIsoDay('2028-02-29')).toBe('2028-03-01');
    expect(nextIsoDay('2026-02-28')).toBe('2026-03-01');
  });

  it('rejects a non-ISO input rather than silently producing NaN', () => {
    expect(() => nextIsoDay('not-a-date')).toThrow();
    expect(() => nextIsoDay('')).toThrow();
  });
});

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

  it('stays correct when a row carries a full timestamp rather than a plain date', () => {
    // The reason the upper bound is `start < nextIsoDay(to)` and not `start <= to`.
    expect(overlapsWindow({ start: '2026-06-20T10:00:00Z', end: null }, { to: '2026-06-20' })).toBe(
      true,
    );
  });
});
