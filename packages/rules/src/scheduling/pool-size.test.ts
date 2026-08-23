/**
 * Pool size configuration tests.
 * Verifies that computePoolSizes handles all edge cases correctly.
 */
import { describe, it, expect } from 'vitest';
import { computePoolSizes } from './snake-seeding';

describe('computePoolSizes — pool size configuration', () => {
  it('exact division: 32 fighters / 4 pools → [8,8,8,8]', () => {
    expect(computePoolSizes(32, 4)).toEqual([8, 8, 8, 8]);
  });

  it('exact division: 24 fighters / 3 pools → [8,8,8]', () => {
    expect(computePoolSizes(24, 3)).toEqual([8, 8, 8]);
  });

  it('uneven: 25 fighters / 4 pools → balanced within ±1', () => {
    const sizes = computePoolSizes(25, 4);
    expect(sizes.reduce((s, n) => s + n, 0)).toBe(25);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('uneven: 17 fighters / 3 pools → [6,6,5]', () => {
    const sizes = computePoolSizes(17, 3);
    expect(sizes.reduce((s, n) => s + n, 0)).toBe(17);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('target size 8: 32 fighters → 4 pools of 8', () => {
    const poolCount = Math.max(1, Math.ceil(32 / 8));
    expect(poolCount).toBe(4);
    expect(computePoolSizes(32, poolCount)).toEqual([8, 8, 8, 8]);
  });

  it('target size 8: 30 fighters → 4 pools (7,8,8,7 or similar)', () => {
    const poolCount = Math.max(1, Math.ceil(30 / 8)); // ceil(30/8)=4
    expect(poolCount).toBe(4);
    const sizes = computePoolSizes(30, poolCount);
    expect(sizes.reduce((s, n) => s + n, 0)).toBe(30);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('target size 6: 18 fighters → 3 pools of 6', () => {
    const poolCount = Math.max(1, Math.ceil(18 / 6));
    expect(poolCount).toBe(3);
    expect(computePoolSizes(18, poolCount)).toEqual([6, 6, 6]);
  });

  it('target size 5: 13 fighters → 3 pools (5,4,4)', () => {
    const poolCount = Math.max(1, Math.ceil(13 / 5)); // ceil(13/5)=3
    const sizes = computePoolSizes(13, poolCount);
    expect(sizes.reduce((s, n) => s + n, 0)).toBe(13);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('1 pool: all fighters in one pool', () => {
    expect(computePoolSizes(10, 1)).toEqual([10]);
  });

  it('N pools = N fighters: 1 fighter per pool', () => {
    expect(computePoolSizes(5, 5)).toEqual([1, 1, 1, 1, 1]);
  });
});
