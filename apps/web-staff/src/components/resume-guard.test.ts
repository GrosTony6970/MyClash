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
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 90_000, false)).toBe(true); // 0:00
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 100_000, false)).toBe(true); // overshot
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 87_000, false)).toBe(true); // 3s left < 5s soft
  });

  it('does not block above the soft-clock zone', () => {
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 26_700, false)).toBe(false); // 63.3s left
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 84_000, false)).toBe(false); // 6s left > 5s soft
  });

  it('never blocks in count-up mode', () => {
    const countup: MatchFormatConfig = { ...countdown, timerMode: 'countup' };
    expect(resumeBlockedByRuleset(countup, 'pool', null, 100_000, false)).toBe(false);
  });

  it('with soft clock 0, only zero remaining blocks', () => {
    const noSoft: MatchFormatConfig = { ...countdown, softClockLimitSeconds: 0 };
    expect(resumeBlockedByRuleset(noSoft, 'pool', null, 90_000, false)).toBe(true); // 0:00
    expect(resumeBlockedByRuleset(noSoft, 'pool', null, 89_000, false)).toBe(false); // 1s left
  });

  it('never blocks while SUDDEN DEATH is live', () => {
    // Sudden death runs with the countdown sitting at 00:00 by design — that is
    // what the state IS. Without this the referee met the challenge modal on
    // every single resume, on the surface that restarts the clock most often.
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 90_000, true)).toBe(false);
    expect(resumeBlockedByRuleset(countdown, 'pool', null, 150_000, true)).toBe(false);
  });
});
