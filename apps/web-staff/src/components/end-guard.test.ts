import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { endIsEarly, endRefusedOnPad, levelBoardWinner, pressedOn } from './end-guard';

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

/**
 * A bout that counts down, both fighters out of points on one exchange: the
 * board reads 0 - 0 and the fighter less far below zero has won (operator,
 * 2026-10-11). With no network the official ends that bout on the tablet. It
 * is not level, and its End is not early.
 */
describe('both at zero in a bout that counts down', () => {
  const reverse: MatchFormatConfig = { ...format, scoringDirection: 'reverse_zero_loses' };
  // Red at -2, blue at -1.
  const blueWon = { redScore: 0, blueScore: 0, redBelowZero: 2, blueBelowZero: 1 };
  const trueTie = { redScore: 0, blueScore: 0, redBelowZero: 1, blueBelowZero: 1 };
  const ask = (score: typeof blueWon, phaseType: 'pool' | 'single_elim' = 'single_elim') =>
    endRefusedOnPad({
      matchFormat: reverse,
      phaseType,
      matchNumberLabel: null,
      elapsedMs: 30_000,
      score,
      levelStepsTaken: 0,
    });

  it('ends at any time, in a bracket and in a Pool: a fighter has won it', () => {
    expect(ask(blueWon)).toBeNull();
    expect(ask(blueWon, 'pool')).toBeNull();
    expect(endIsEarly(reverse, 'single_elim', null, 30_000, blueWon)).toBe(false);
  });

  it('is still a level bout when both went as far below', () => {
    expect(ask(trueTie)).toEqual({ reason: 'time_not_finished' });
  });

  it('is still a level bout for a caller that holds the two scores alone', () => {
    expect(ask({ redScore: 0, blueScore: 0 } as typeof blueWon)).toEqual({
      reason: 'time_not_finished',
    });
  });

  it('names the winner of a level board, and nobody where the board has a leader', () => {
    expect(levelBoardWinner(blueWon, reverse)).toBe('blue');
    expect(levelBoardWinner({ ...blueWon, redBelowZero: 0, blueBelowZero: 3 }, reverse)).toBe(
      'red',
    );
    expect(levelBoardWinner(trueTie, reverse)).toBeNull();
    // A leader on the board is read from the board, as before.
    expect(levelBoardWinner({ redScore: 0, blueScore: 2 }, reverse)).toBeNull();
    // A bout that counts up, level at the cap: nobody.
    expect(levelBoardWinner({ redScore: 10, blueScore: 10 }, format)).toBeNull();
  });

  it('presses the End on the score of the screen, with the winner the cap names', () => {
    expect(pressedOn(blueWon, reverse)).toEqual({ red: 0, blue: 0, winner: 'blue' });
    expect(pressedOn(trueTie, reverse)).toEqual({ red: 0, blue: 0 });
    // A card is on the board: red at -3, blue at -1 and a card of -1. The two
    // numbers alone would name red.
    const carded = { redScore: 0, blueScore: -1, redBelowZero: 3, blueBelowZero: 1 };
    expect(pressedOn(carded, reverse)).toEqual({ red: 0, blue: -1, winner: 'blue' });
  });

  it('presses an End with no winner while the cap has given the bout to nobody', () => {
    expect(pressedOn({ redScore: 4, blueScore: 2 }, reverse)).toEqual({ red: 4, blue: 2 });
    expect(pressedOn({ redScore: 3, blueScore: 1 }, format)).toEqual({ red: 3, blue: 1 });
    expect(pressedOn({ redScore: 10, blueScore: 4 }, format)).toEqual({
      red: 10,
      blue: 4,
      winner: 'red',
    });
  });
});
