import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { endIsEarly } from './end-guard';

// A 90s pool bout to 10 points.
const format: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 10,
  timeLimitsSeconds: { pool: 90, bracket: 180, finals: 180 },
};
const score = (redScore: number, blueScore: number) => ({ redScore, blueScore });

describe('endIsEarly', () => {
  it('is early while neither the cap nor the time is reached', () => {
    expect(endIsEarly(format, 'pool', null, 30_000, score(3, 1))).toBe(true);
    expect(endIsEarly(format, 'pool', null, 89_999, score(9, 9))).toBe(true);
    expect(endIsEarly(format, 'pool', null, 0, score(0, 0))).toBe(true);
  });

  it('is not early once the time is reached', () => {
    expect(endIsEarly(format, 'pool', null, 90_000, score(3, 1))).toBe(false);
    expect(endIsEarly(format, 'pool', null, 95_000, score(0, 0))).toBe(false);
  });

  it('is not early once a fighter is at the cap', () => {
    expect(endIsEarly(format, 'pool', null, 30_000, score(10, 4))).toBe(false);
    expect(endIsEarly(format, 'pool', null, 30_000, score(4, 11))).toBe(false);
  });

  it("counts the time against the bout's own phase", () => {
    // 100s is past the pool's 90s and inside the bracket's 180s.
    expect(endIsEarly(format, 'pool', null, 100_000, score(3, 1))).toBe(false);
    expect(endIsEarly(format, 'single_elim', null, 100_000, score(3, 1))).toBe(true);
  });

  it('is never early in a phase with no time limit: there is no time to wait for', () => {
    const unlimited: MatchFormatConfig = {
      ...format,
      timeLimitsSeconds: { pool: null, swiss: null, bracket: null, finals: null },
    };
    expect(endIsEarly(unlimited, 'pool', null, 30_000, score(3, 1))).toBe(false);
  });

  it('reads the cap the way the format scores: at zero when it counts down', () => {
    const reverse: MatchFormatConfig = { ...format, scoringDirection: 'reverse_zero_loses' };
    expect(endIsEarly(reverse, 'pool', null, 30_000, score(4, 0))).toBe(false);
    expect(endIsEarly(reverse, 'pool', null, 30_000, score(4, 2))).toBe(true);
  });
});
