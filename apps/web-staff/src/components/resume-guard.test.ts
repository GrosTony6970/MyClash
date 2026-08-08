import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { resumeBlockedByRuleset } from './resume-guard';

// 90s pool limit, 5s soft clock — the TF v1 shape.
const countdown: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
  softClockLimitSeconds: 5,
};

describe('resumeBlockedByRuleset', () => {
  it('blocks at zero remaining and inside the soft-clock zone', () => {
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 90_000)).toBe(true); // 0:00
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 100_000)).toBe(true); // overshot
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 87_000)).toBe(true); // 3s left < 5s soft
  });

  it('does not block above the soft-clock zone', () => {
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 26_700)).toBe(false); // 63.3s left
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 84_000)).toBe(false); // 6s left > 5s soft
  });

  it('never blocks in count-up mode', () => {
    const countup: MatchFormatConfig = { ...countdown, timerMode: 'countup' };
    expect(resumeBlockedByRuleset(countup, 'pool', null, 100_000)).toBe(false);
  });

  it('with soft clock 0, only zero remaining blocks', () => {
    const noSoft: MatchFormatConfig = { ...countdown, softClockLimitSeconds: 0 };
    expect(resumeBlockedByRuleset(noSoft, 'pool', null, 90_000)).toBe(true); // 0:00
    expect(resumeBlockedByRuleset(noSoft, 'pool', null, 89_000)).toBe(false); // 1s left
  });
});
