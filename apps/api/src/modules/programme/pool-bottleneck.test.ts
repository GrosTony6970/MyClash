import { describe, expect, it } from 'vitest';
import { poolBottleneckMinutes } from './pool-bottleneck';

describe('poolBottleneckMinutes', () => {
  it('drives duration off the busiest lice, not the total / lices', () => {
    // 2 pools of 28, 4 lices, 5-min matches + 10s gap. Strict affinity puts
    // each pool on its own lice → busiest lice = 28 matches, only 2 lices used.
    // (The naive ceil(56/4)=14 estimate would be wrong.)
    const { minutes, licesUsed } = poolBottleneckMinutes([28, 28], 4, 5, 10);
    expect(licesUsed).toBe(2);
    expect(minutes).toBeCloseTo(28 * (5 + 10 / 60), 5);
  });

  it('wraps pools round-robin when pools exceed lices', () => {
    // 6 pools of 10 across 4 lices: lices 0 and 1 each carry pools {0,4} and
    // {1,5} → 20 matches; the busiest lice holds 20.
    const { minutes, licesUsed } = poolBottleneckMinutes([10, 10, 10, 10, 10, 10], 4, 5, 0);
    expect(licesUsed).toBe(4);
    expect(minutes).toBe(20 * 5);
  });

  it('a single pool occupies one lice for its full length', () => {
    const { minutes, licesUsed } = poolBottleneckMinutes([12], 4, 5, 0);
    expect(licesUsed).toBe(1);
    expect(minutes).toBe(12 * 5);
  });

  it('returns zero for no pools or no lices', () => {
    expect(poolBottleneckMinutes([], 4, 5, 10)).toEqual({ minutes: 0, licesUsed: 0 });
    expect(poolBottleneckMinutes([10], 0, 5, 10)).toEqual({ minutes: 0, licesUsed: 0 });
  });
});
