import { describe, expect, it } from 'vitest';
import { formatMatchClock } from './format-match-clock';

describe('formatMatchClock', () => {
  it('returns empty string for null/undefined (legacy rows)', () => {
    expect(formatMatchClock(null)).toBe('');
    expect(formatMatchClock(undefined)).toBe('');
  });

  it('formats accumulated active ms as MM:SS', () => {
    expect(formatMatchClock(0)).toBe('00:00');
    expect(formatMatchClock(65_000)).toBe('01:05');
    expect(formatMatchClock(600_000)).toBe('10:00');
  });

  it('floors sub-second remainders', () => {
    expect(formatMatchClock(65_900)).toBe('01:05');
  });

  it('clamps negatives to 00:00', () => {
    expect(formatMatchClock(-5_000)).toBe('00:00');
  });
});
