import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { clockShouldTick, scoreboardClockMs, type ClockState } from './scoreboard-clock';

const NOW = 1_000_000;

function halted(activeMs: number): ClockState {
  return {
    matchId: 'm',
    status: 'halted',
    activeMs,
    runningFrom: null,
    totalActiveMs: activeMs,
    startedAt: null,
  };
}

function running(activeMs: number, runningFromMsAgo: number): ClockState {
  const ts = new Date(NOW - runningFromMsAgo).toISOString();
  return {
    matchId: 'm',
    status: 'running',
    activeMs,
    runningFrom: ts,
    totalActiveMs: activeMs,
    startedAt: ts,
  };
}

const countup: MatchFormatConfig = { ...DEFAULT_MATCH_FORMAT_CONFIG, timerMode: 'countup' };
const countdownPool90: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
};

describe('scoreboardClockMs', () => {
  it('shows elapsed time (counts up) in count-up mode', () => {
    expect(scoreboardClockMs(halted(5000), NOW, countup, 'pool', null)).toBe(5000);
  });

  it('counts down from the phase time limit in countdown mode', () => {
    expect(scoreboardClockMs(halted(5000), NOW, countdownPool90, 'pool', null)).toBe(85_000);
  });

  it('clamps the countdown at zero once elapsed exceeds the limit', () => {
    expect(scoreboardClockMs(halted(95_000), NOW, countdownPool90, 'pool', null)).toBe(0);
  });

  it('falls back to elapsed when the phase has no time limit', () => {
    const noLimit: MatchFormatConfig = {
      ...countdownPool90,
      timeLimitsSeconds: { pool: null, bracket: null, finals: null },
    };
    expect(scoreboardClockMs(halted(5000), NOW, noLimit, 'pool', null)).toBe(5000);
  });

  it('adds wall time since runningFrom while the clock is running', () => {
    // 5000 active + 2000 since runningFrom = 7000 elapsed → count-up shows 7000
    expect(scoreboardClockMs(running(5000, 2000), NOW, countup, 'pool', null)).toBe(7000);
  });

  it('treats a null clock as zero elapsed: 0 in count-up, full limit in countdown', () => {
    expect(scoreboardClockMs(null, NOW, countup, 'pool', null)).toBe(0);
    // Before the clock starts, a countdown shows the full match time (01:30).
    expect(scoreboardClockMs(null, NOW, countdownPool90, 'pool', null)).toBe(90_000);
  });
});

describe('clockShouldTick', () => {
  it('ticks while running AND while halted (the wall-clock total keeps flowing), not idle/ended', () => {
    expect(clockShouldTick('running')).toBe(true);
    expect(clockShouldTick('halted')).toBe(true);
    expect(clockShouldTick('idle')).toBe(false);
    expect(clockShouldTick('ended')).toBe(false);
  });
});
