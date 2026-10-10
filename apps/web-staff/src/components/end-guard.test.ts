import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { endIsEarly, endRefusedOnPad } from './end-guard';

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

/**
 * "End match" is taken on the tablet (operator ruling 11), so the pad gives
 * the two refusals the server gives a level bout, before it shows a result.
 */
describe('endRefusedOnPad', () => {
  // The default chains: a pool bout may end level; a bracket bout plays a
  // minute of extra time, then sudden death.
  const ask = (
    phaseType: 'pool' | 'single_elim',
    elapsedMs: number,
    redScore: number,
    blueScore: number,
    levelStepsTaken = 0,
  ) =>
    endRefusedOnPad({
      matchFormat: format,
      phaseType,
      matchNumberLabel: null,
      elapsedMs,
      score: { redScore, blueScore },
      levelStepsTaken,
    });

  it('ends a bout that has a leader, at any time', () => {
    expect(ask('pool', 10_000, 3, 1)).toBeNull();
    expect(ask('single_elim', 10_000, 1, 3)).toBeNull();
    expect(ask('single_elim', 200_000, 3, 1)).toBeNull();
  });

  it('does not end a level bout with time left: there is nothing to decide yet', () => {
    expect(ask('pool', 89_999, 3, 3)).toEqual({ reason: 'time_not_finished' });
    expect(ask('single_elim', 30_000, 0, 0)).toEqual({ reason: 'time_not_finished' });
  });

  it('ends a level pool bout at its time: a draw is a result there', () => {
    expect(ask('pool', 90_000, 3, 3)).toBeNull();
  });

  it('does not end a level bracket bout at its time, and names the remedy', () => {
    expect(ask('single_elim', 180_000, 3, 3)).toEqual({
      reason: 'level',
      step: { kind: 'extra_time', seconds: 60 },
    });
  });

  it('names the next remedy once one was played, and none once the chain is spent', () => {
    expect(ask('single_elim', 180_000, 3, 3, 1)).toEqual({
      reason: 'level',
      step: { kind: 'sudden_death' },
    });
    expect(ask('single_elim', 180_000, 3, 3, 2)).toEqual({ reason: 'level', step: null });
  });

  it('reads the time against the bout’s own phase', () => {
    // 100s is past the pool's 90s and inside the bracket's 180s.
    expect(ask('pool', 100_000, 2, 2)).toBeNull();
    expect(ask('single_elim', 100_000, 2, 2)).toEqual({ reason: 'time_not_finished' });
  });
});
