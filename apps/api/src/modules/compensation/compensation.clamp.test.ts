import { describe, expect, it } from 'vitest';
import { clampCompensationAmount } from './compensation.service';

describe('clampCompensationAmount', () => {
  it('returns the amount unchanged when there is no cap or floor', () => {
    expect(clampCompensationAmount(25, null, null)).toBe(25);
  });

  it('clamps down to the cap', () => {
    expect(clampCompensationAmount(80, 50, null)).toBe(50);
    expect(clampCompensationAmount(30, 50, null)).toBe(30);
  });

  it('floors a low amount up to the minimum (referee who worked is guaranteed it)', () => {
    expect(clampCompensationAmount(0, null, 10)).toBe(10);
    expect(clampCompensationAmount(15, null, 10)).toBe(15);
  });

  it('applies both: within the band is unchanged, outside is clamped', () => {
    expect(clampCompensationAmount(5, 50, 10)).toBe(10); // below floor
    expect(clampCompensationAmount(30, 50, 10)).toBe(30); // within band
    expect(clampCompensationAmount(90, 50, 10)).toBe(50); // above cap
  });

  it('lets the floor win when the floor exceeds the cap', () => {
    expect(clampCompensationAmount(5, 20, 40)).toBe(40);
    expect(clampCompensationAmount(100, 20, 40)).toBe(40);
  });
});
