import { describe, expect, it } from 'vitest';
import { parseSideColors } from './parse-side-colors';

describe('parseSideColors', () => {
  it('returns the configured side colours from scoring_config_json', () => {
    const row = {
      scoring_config_json: { display: { sideColors: { red: 'green', blue: 'yellow' } } },
    };
    expect(parseSideColors(row)).toEqual({ red: 'green', blue: 'yellow' });
  });

  it('falls back to red/blue when the colours sit under the wrong scoring_config key', () => {
    // Regression: the bug read `scoring_config` instead of `scoring_config_json`,
    // so the configured colours were silently ignored.
    const row = { scoring_config: { display: { sideColors: { red: 'green', blue: 'yellow' } } } };
    expect(parseSideColors(row)).toEqual({ red: 'red', blue: 'blue' });
  });

  it('falls back to red/blue when the config is missing or empty', () => {
    expect(parseSideColors(null)).toEqual({ red: 'red', blue: 'blue' });
    expect(parseSideColors({})).toEqual({ red: 'red', blue: 'blue' });
    expect(parseSideColors({ scoring_config_json: { display: {} } })).toEqual({
      red: 'red',
      blue: 'blue',
    });
  });
});
