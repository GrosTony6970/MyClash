import { describe, it, expect } from 'vitest';
import { blockWindowEndIso } from './block-window-end';

describe('blockWindowEndIso', () => {
  it('rounds the run up to the next half hour (matches the schedule block window)', () => {
    // 28-fight pool: 09:00 → real last-fight end 11:34 (154 min) → block 12:00.
    expect(blockWindowEndIso('2026-01-01T09:00:00.000Z', '2026-01-01T11:34:00.000Z')).toBe(
      '2026-01-01T12:00:00.000Z',
    );
  });

  it('rounds a sub-30-minute run up to a 30-minute window', () => {
    // single match: 09:00 → +5 min → 09:30 window
    expect(blockWindowEndIso('2026-01-01T09:00:00.000Z', '2026-01-01T09:05:00.000Z')).toBe(
      '2026-01-01T09:30:00.000Z',
    );
  });

  it('leaves an exact half-hour run unchanged', () => {
    expect(blockWindowEndIso('2026-01-01T09:00:00.000Z', '2026-01-01T09:30:00.000Z')).toBe(
      '2026-01-01T09:30:00.000Z',
    );
  });

  it('falls back to the raw end ISO when inputs are unusable', () => {
    expect(blockWindowEndIso('not-a-date', '2026-01-01T09:30:00.000Z')).toBe(
      '2026-01-01T09:30:00.000Z',
    );
    // end <= start → return the raw end rather than rounding backwards
    expect(blockWindowEndIso('2026-01-01T10:00:00.000Z', '2026-01-01T09:00:00.000Z')).toBe(
      '2026-01-01T09:00:00.000Z',
    );
  });
});
