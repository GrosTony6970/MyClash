import { describe, expect, it } from 'vitest';
import { sideColorsFromScoringConfig } from './side-colors';

describe('sideColorsFromScoringConfig', () => {
  it('returns the configured side colors when both are set', () => {
    expect(
      sideColorsFromScoringConfig({ display: { sideColors: { red: 'black', blue: 'white' } } }),
    ).toEqual({ red: 'black', blue: 'white' });
  });

  it('defaults to red / blue when the config is null or missing', () => {
    expect(sideColorsFromScoringConfig(null)).toEqual({ red: 'red', blue: 'blue' });
    expect(sideColorsFromScoringConfig(undefined)).toEqual({ red: 'red', blue: 'blue' });
    expect(sideColorsFromScoringConfig({})).toEqual({ red: 'red', blue: 'blue' });
    expect(sideColorsFromScoringConfig({ display: {} })).toEqual({ red: 'red', blue: 'blue' });
  });

  it('fills the missing side from the default when only one is configured', () => {
    expect(sideColorsFromScoringConfig({ display: { sideColors: { red: 'purple' } } })).toEqual({
      red: 'purple',
      blue: 'blue',
    });
    expect(sideColorsFromScoringConfig({ display: { sideColors: { blue: 'green' } } })).toEqual({
      red: 'red',
      blue: 'green',
    });
  });
});
