import { describe, it, expect } from 'vitest';
import { formatFightOfTotal } from './format-fight-of-total';

describe('formatFightOfTotal', () => {
  it('renders Fight X / Y when both args are positive', () => {
    expect(formatFightOfTotal(3, 16)).toBe('Fight 3 / 16');
    expect(formatFightOfTotal(1, 1)).toBe('Fight 1 / 1');
  });

  it('returns null when either index or total is null/undefined', () => {
    expect(formatFightOfTotal(null, 16)).toBeNull();
    expect(formatFightOfTotal(3, null)).toBeNull();
    expect(formatFightOfTotal(null, null)).toBeNull();
    expect(formatFightOfTotal(undefined, 16)).toBeNull();
    expect(formatFightOfTotal(3, undefined)).toBeNull();
  });

  it('returns null when total or index is zero or negative (defensive)', () => {
    expect(formatFightOfTotal(0, 16)).toBeNull();
    expect(formatFightOfTotal(3, 0)).toBeNull();
    expect(formatFightOfTotal(-1, 16)).toBeNull();
  });
});
