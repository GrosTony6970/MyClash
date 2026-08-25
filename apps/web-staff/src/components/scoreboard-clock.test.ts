import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  type LevelStep,
  type MatchFormatConfig,
} from '@myclash/types';
import {
  clockShouldTick,
  remedyToOffer,
  scoreboardClockMs,
  suddenDeathElapsedMs,
  type ClockState,
} from './scoreboard-clock';

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

  it('counts a Swiss bout against the SWISS limit, and the pool limit when unset', () => {
    // This module used to bill Swiss at the bracket limit, disagreeing with the
    // engine that ends the bout (`swiss ?? pool`). Now delegated to
    // @myclash/types, which mirrors the engine.
    const withSwiss: MatchFormatConfig = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timerMode: 'countdown',
      timeLimitsSeconds: { pool: 90, swiss: 120, bracket: 180, finals: 240 },
    };
    expect(scoreboardClockMs(halted(20_000), NOW, withSwiss, 'swiss', null)).toBe(100_000);

    const preSwiss: MatchFormatConfig = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timerMode: 'countdown',
      timeLimitsSeconds: { pool: 90, bracket: 180, finals: 240 },
    };
    expect(scoreboardClockMs(halted(20_000), NOW, preSwiss, 'swiss', null)).toBe(70_000);
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

/**
 * The count-up under the SKULL, once sudden death is live.
 *
 * It replaces the numeral rather than sitting beside it, because a countdown
 * pinned at 00:00 tells the referee nothing about how long the deciding
 * exchange has taken.
 */
describe('suddenDeathElapsedMs', () => {
  it('counts from the moment the countdown reached zero', () => {
    expect(suddenDeathElapsedMs(90_000, 90_000)).toBe(0);
    expect(suddenDeathElapsedMs(112_000, 90_000)).toBe(22_000);
  });

  it('needs no state of its own after extra time was granted', () => {
    // Extra time is an `adjust_time` row, so it has ALREADY moved elapsed: a
    // 90s limit plus 60s of extra time reads as 30s elapsed, and the count-up
    // starts again from the extended zero without being told about it.
    expect(suddenDeathElapsedMs(30_000, 90_000)).toBe(0);
    expect(suddenDeathElapsedMs(95_000, 90_000)).toBe(5_000);
  });

  it('is the elapsed time when there is no limit to count from', () => {
    // A count-up tournament, or a phase configured with no time limit.
    expect(suddenDeathElapsedMs(45_000, null)).toBe(45_000);
  });
});

/**
 * Whether the pad offers the remedy button at all.
 *
 * The server refuses both the End and the advance while a level bout still has
 * time to run, so a button shown before then is one that answers with a 400 —
 * and a scorekeeper mid-event cannot debug a 400.
 */
describe('remedyToOffer', () => {
  const EXTRA: LevelStep = { kind: 'extra_time', seconds: 60 };
  const SUDDEN: LevelStep = { kind: 'sudden_death' };

  it('offers nothing while the bout still has time', () => {
    expect(remedyToOffer(EXTRA, 89_999, countdownPool90, 'pool', null)).toBeNull();
  });

  it('offers the chain step once the time is up', () => {
    expect(remedyToOffer(EXTRA, 90_000, countdownPool90, 'pool', null)).toEqual(EXTRA);
    expect(remedyToOffer(SUDDEN, 120_000, countdownPool90, 'pool', null)).toEqual(SUDDEN);
  });

  it('offers nothing for a draw step, which is not a remedy', () => {
    // A drawn pool bout is a real result: the referee simply ends it, and the
    // standings have a D column for it.
    expect(remedyToOffer({ kind: 'draw' }, 120_000, countdownPool90, 'pool', null)).toBeNull();
  });

  it('offers nothing when the chain is spent', () => {
    // Sudden death is already live — terminal, so there is nothing to advance
    // to and the bout ends when one fighter leads.
    expect(remedyToOffer(null, 120_000, countdownPool90, 'pool', null)).toBeNull();
  });

  it('holds the button in COUNT-UP too, where the limit is just as real', () => {
    // `timerMode` is display only. A count-up bout with a 90s limit ends at 90s
    // whether or not the numeral counts towards it.
    const countupPool90: MatchFormatConfig = { ...countdownPool90, timerMode: 'countup' };
    expect(remedyToOffer(EXTRA, 60_000, countupPool90, 'pool', null)).toBeNull();
    expect(remedyToOffer(EXTRA, 90_000, countupPool90, 'pool', null)).toEqual(EXTRA);
  });

  it('offers at once when the phase has NO limit', () => {
    // Nothing to wait for, so the chain decides such a bout immediately.
    const noLimit: MatchFormatConfig = {
      ...countdownPool90,
      timeLimitsSeconds: { pool: null, bracket: 90, finals: 90 },
    };
    expect(remedyToOffer(EXTRA, 0, noLimit, 'pool', null)).toEqual(EXTRA);
  });
});
