import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { endIsEarly, endRefusedOnPad, levelBoardWinner, limitEnd, pressedOn } from './end-guard';

// A 90s pool bout to 10 points.
const format: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 10,
  timeLimitsSeconds: { pool: 90, bracket: 180, finals: 180 },
};
const score = (redScore: number, blueScore: number, doubles = 0) => ({
  redScore,
  blueScore,
  doubles,
});
const POOL = { phaseType: 'pool' as const, matchNumberLabel: null };

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
      score: score(redScore, blueScore),
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
  const blueWon = { ...score(0, 0), redBelowZero: 2, blueBelowZero: 1 };
  const trueTie = { ...score(0, 0), redBelowZero: 1, blueBelowZero: 1 };
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
    expect(ask(score(0, 0) as typeof blueWon)).toEqual({
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
    expect(pressedOn(blueWon, reverse, POOL)).toEqual({ red: 0, blue: 0, winner: 'blue' });
    expect(pressedOn(trueTie, reverse, POOL)).toEqual({ red: 0, blue: 0 });
    // A card is on the board: red at -3, blue at -1 and a card of -1. The two
    // numbers alone would name red.
    const carded = { ...score(0, -1), redBelowZero: 3, blueBelowZero: 1 };
    expect(pressedOn(carded, reverse, POOL)).toEqual({ red: 0, blue: -1, winner: 'blue' });
  });

  it('presses an End with no winner while the cap has given the bout to nobody', () => {
    expect(pressedOn(score(4, 2), reverse, POOL)).toEqual({ red: 4, blue: 2 });
    expect(pressedOn(score(3, 1), format, POOL)).toEqual({ red: 3, blue: 1 });
    expect(pressedOn(score(10, 4), format, POOL)).toEqual({
      red: 10,
      blue: 4,
      winner: 'red',
    });
  });
});

/**
 * A Pool bout of one round at its doubles limit, with no network (operator,
 * 2026-10-11). The server ends that bout on the double that reaches the limit;
 * the tablet ends no bout of one round by itself, so the official presses "End
 * match". That press must say what the server will say. Before, it named the
 * leader on the board, and it refused a level board "until the time is
 * finished": with no network that bout could not be ended.
 *
 * Limit 3, first to 10, 30 seconds of 90 on the clock.
 */
describe('"End match" at the doubles limit', () => {
  const limited = (over: Partial<MatchFormatConfig> = {}): MatchFormatConfig => ({
    ...format,
    maxDoubleHits: 3,
    ...over,
  });
  const down = (over: Partial<MatchFormatConfig> = {}) =>
    limited({ scoringDirection: 'reverse_zero_loses', ...over });
  const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };
  const refused = (
    board: ReturnType<typeof score>,
    matchFormat: MatchFormatConfig,
    bout: { phaseType: 'pool' | 'swiss' | 'single_elim'; matchNumberLabel: string | null } = POOL,
  ) =>
    endRefusedOnPad({ matchFormat, ...bout, elapsedMs: 30_000, score: board, levelStepsTaken: 0 });

  it('ends a level board with time left: the limit is the result', () => {
    expect(refused(score(1, 1, 3), limited())).toBeNull();
    expect(refused(score(9, 9, 3), down())).toBeNull();
    // One double short of the limit: a level board waits for its time, as before.
    expect(refused(score(1, 1, 2), limited())).toEqual({ reason: 'time_not_finished' });
  });

  it('asks no "end now?" at the limit', () => {
    expect(endIsEarly(limited(), 'pool', null, 30_000, score(2, 1, 3))).toBe(false);
    expect(endIsEarly(down(), 'swiss', null, 30_000, score(8, 9, 3))).toBe(false);
    expect(endIsEarly(limited(), 'pool', null, 30_000, score(2, 1, 2))).toBe(true);
  });

  it('presses the End on a wiped board with nobody ahead: a loss for both', () => {
    const lossForBoth = { red: 0, blue: 0, endReason: 'max_doubles' };
    // Counting up, blue leads 2 - 1. Counting down, red leads 9 - 8.
    expect(pressedOn(score(1, 2, 3), limited(), POOL)).toEqual(lossForBoth);
    expect(pressedOn(score(9, 8, 3), down(), POOL)).toEqual(lossForBoth);
    expect(pressedOn(score(1, 2, 4), limited(), { ...POOL, phaseType: 'swiss' })).toEqual(
      lossForBoth,
    );
  });

  it('presses it as the draw the format asks for, on a wiped board', () => {
    const draw = { maxDoubleHitOutcome: 'draw_zero_scores' as const };
    expect(pressedOn(score(1, 2, 3), limited(draw), POOL)).toEqual({
      red: 0,
      blue: 0,
      endReason: 'max_doubles_draw',
    });
  });

  it('keeps the board where the result stands: its leader is read from it', () => {
    const stands = { maxDoubleHitOutcome: 'result_stands' as const };
    expect(pressedOn(score(1, 2, 3), limited(stands), POOL)).toEqual({
      red: 1,
      blue: 2,
      endReason: 'max_doubles_result_stands',
    });
    // Level there is a draw: the board stands, and nobody is named.
    expect(pressedOn(score(2, 2, 3), limited(stands), POOL)).toEqual({
      red: 2,
      blue: 2,
      endReason: 'max_doubles_result_stands',
    });
    expect(refused(score(2, 2, 3), limited(stands))).toBeNull();
  });

  it('has no limit in a bracket, and none where the format has none', () => {
    expect(limitEnd(score(1, 2, 3), BRACKET, limited())).toBeNull();
    expect(pressedOn(score(1, 2, 3), limited(), BRACKET)).toEqual({ red: 1, blue: 2 });
    expect(refused(score(1, 1, 3), limited(), BRACKET)).toEqual({ reason: 'time_not_finished' });
    expect(endIsEarly(limited(), 'single_elim', null, 30_000, score(2, 1, 3))).toBe(true);
    expect(pressedOn(score(1, 2, 3), limited({ maxDoubleHits: null }), POOL)).toEqual({
      red: 1,
      blue: 2,
    });
  });

  it('leaves a board at the cap AND at the limit to the cap, in a bout that counts up', () => {
    expect(limitEnd(score(10, 4, 3), POOL, limited())).toBeNull();
    expect(pressedOn(score(10, 4, 3), limited(), POOL)).toEqual({
      red: 10,
      blue: 4,
      winner: 'red',
    });
  });

  it('asks the limit first in a bout that counts down, as the server does', () => {
    // Red is out of points and the doubles are at the limit: a loss for both.
    expect(pressedOn(score(0, 4, 3), down(), POOL)).toEqual({
      red: 0,
      blue: 0,
      endReason: 'max_doubles',
    });
  });
});
