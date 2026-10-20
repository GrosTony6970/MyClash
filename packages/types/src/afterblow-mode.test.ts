import { describe, expect, it } from 'vitest';
import { afterblowModeInForce, DEFAULT_SCORING_CONFIG } from './scoring-config';

/**
 * How a Tournament's stored scoring config scores an afterblow (operator ruling 47, 2026-10-20):
 * `deductive` only when it says so; a missing key, a NULL column or an unknown value is `full`,
 * as the scorer plays it.
 */
describe('afterblowModeInForce', () => {
  it('is deductive only when the config says deductive', () => {
    expect(afterblowModeInForce({ afterblowMode: 'deductive' })).toBe('deductive');
    expect(afterblowModeInForce({ afterblowMode: 'full' })).toBe('full');
  });

  it('is full for a missing key, a NULL column and an unknown value', () => {
    expect(afterblowModeInForce({})).toBe('full');
    expect(afterblowModeInForce(null)).toBe('full');
    expect(afterblowModeInForce(undefined)).toBe('full');
    expect(afterblowModeInForce({ afterblowMode: 'none' })).toBe('full');
  });

  it('agrees with the default config a Tournament with none plays', () => {
    expect(DEFAULT_SCORING_CONFIG.afterblowMode).toBe('full');
  });
});
