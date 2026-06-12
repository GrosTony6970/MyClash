import { describe, expect, it } from 'vitest';
import { exchangeDeltaLabel } from './exchange-delta-label';

describe('exchangeDeltaLabel', () => {
  it('shows +0 for a zero-point afterblow (1-1) so the exchange reads as registered', () => {
    expect(exchangeDeltaLabel('afterblow', 0)).toBe('+0');
  });

  it('shows the positive delta for scoring exchanges', () => {
    expect(exchangeDeltaLabel('clean', 2)).toBe('+2');
    expect(exchangeDeltaLabel('afterblow', 1)).toBe('+1');
  });

  it('shows nothing for doubles, no-exchanges, and legacy rows without a delta', () => {
    expect(exchangeDeltaLabel('double', 0)).toBeNull();
    expect(exchangeDeltaLabel('no_exchange', null)).toBeNull();
    expect(exchangeDeltaLabel('afterblow', null)).toBeNull();
    expect(exchangeDeltaLabel('clean', undefined)).toBeNull();
  });
});
