import { describe, expect, it } from 'vitest';
import { roundUpToHalfHourMin } from './round-duration';

describe('roundUpToHalfHourMin', () => {
  it('rounds a duration up to the next 30-minute boundary', () => {
    expect(roundUpToHalfHourMin(105)).toBe(120); // 1h45 → 2h
    expect(roundUpToHalfHourMin(63)).toBe(90); // 1h03 → 1h30
    expect(roundUpToHalfHourMin(1)).toBe(30);
  });

  it('leaves exact half-hour multiples unchanged', () => {
    expect(roundUpToHalfHourMin(60)).toBe(60);
    expect(roundUpToHalfHourMin(30)).toBe(30);
    expect(roundUpToHalfHourMin(90)).toBe(90);
  });

  it('returns 0 for a non-positive duration', () => {
    expect(roundUpToHalfHourMin(0)).toBe(0);
    expect(roundUpToHalfHourMin(-5)).toBe(0);
  });
});
