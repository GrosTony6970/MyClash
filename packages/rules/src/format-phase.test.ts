import { describe, expect, it } from 'vitest';
import { effectiveTimeLimitSeconds, formatPhaseOf, type MatchFormatConfig } from './index';

/**
 * The format phase of a bout, the one rule the engine and the rules lock share:
 * a finals key locks once a medal bout has started, and a medal bout reads the
 * finals clock. The two must name the same bout the same way.
 */
describe('formatPhaseOf', () => {
  it('names a pool and a Swiss round by their phase type, whatever the label', () => {
    expect(formatPhaseOf('pool', 'FINAL')).toBe('pool');
    expect(formatPhaseOf('swiss', 'GOLD')).toBe('swiss');
  });

  it('names an elimination bout with a medal label the finals', () => {
    expect(formatPhaseOf('single_elim', 'Gold')).toBe('finals');
    expect(formatPhaseOf('double_elim', ' bronze ')).toBe('finals');
    expect(formatPhaseOf(undefined, 'F')).toBe('finals');
  });

  it('names any other bout the bracket', () => {
    expect(formatPhaseOf('single_elim', 'QF1')).toBe('bracket');
    expect(formatPhaseOf(undefined, null)).toBe('bracket');
  });

  it('is the rule the engine reads its per-phase values by', () => {
    const config = {
      timeLimitsSeconds: { pool: 60, swiss: 70, bracket: 80, finals: 90 },
    } as MatchFormatConfig;
    expect(effectiveTimeLimitSeconds(config, 'single_elim', 'BRONZE')).toBe(90);
    expect(effectiveTimeLimitSeconds(config, 'single_elim', 'SF1')).toBe(80);
    expect(effectiveTimeLimitSeconds(config, 'swiss', null)).toBe(70);
    // A Swiss round without its own value reads the pool's.
    const noSwiss = { timeLimitsSeconds: { pool: 60, bracket: 80, finals: 90 } };
    expect(effectiveTimeLimitSeconds(noSwiss as MatchFormatConfig, 'swiss', null)).toBe(60);
  });
});
