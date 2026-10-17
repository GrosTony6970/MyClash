/**
 * The two editions of the end decision (operator ruling "TF_v1 version",
 * 2026-10-16: a ruleset version keeps the decision of its day).
 *
 * Both moved on 2026-10-11, for a bout that counts down only. Countdown from 5:
 * - Both out of points on one afterblow, red 2 below zero, blue 1 below. The
 *   board reads 0 - 0. Before: the leader on the board, so nobody. Since: blue,
 *   who is less far below (`c7cedc92`).
 * - A Pool bout at its doubles limit of 3, the board wiped to 0 - 0. Before:
 *   the cap was asked first, and 0 - 0 reads "both out of points", so the bout
 *   ended "first to points" with nobody ahead. Since: the doubles limit first,
 *   a loss for both (`6b30e5bc`).
 * A bout that counts up is decided the same by both.
 */
import { describe, expect, it } from 'vitest';
import type { Match, MatchFormatConfig } from './index';
import {
  EDITION_2026_04,
  EDITION_2026_10,
  capLeader,
  evaluateRound,
  getPointCapWinnerRegistrationId,
  pointCapEndsBout,
  pointCapWinnerColor,
  roundOutcome,
  type DecisionEdition,
} from './match-format';

function config(over: Partial<MatchFormatConfig> = {}): MatchFormatConfig {
  return {
    pointCap: 5,
    scoringDirection: 'reverse_zero_loses',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 3,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
    ...over,
  };
}

const POOL = { phaseType: 'pool' as const, matchNumberLabel: 'L1-P1-M01' };
const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };
const BOTH_OUT = { redScore: 0, blueScore: 0, redBelowZero: 2, blueBelowZero: 1, doubles: 0 };
const WIPED = { redScore: 0, blueScore: 0, doubles: 3 };

describe('both out of points in a bout that counts down', () => {
  it('2026-04 reads the board: 0 - 0 is nobody', () => {
    expect(capLeader(BOTH_OUT, config(), EDITION_2026_04)).toBeNull();
    expect(pointCapWinnerColor(BOTH_OUT, config(), EDITION_2026_04)).toBeNull();
  });

  it('2026-10 names the fighter less far below zero', () => {
    expect(capLeader(BOTH_OUT, config(), EDITION_2026_10)).toBe('blue');
    expect(pointCapWinnerColor(BOTH_OUT, config(), EDITION_2026_10)).toBe('blue');
  });

  it('a bracket bout stays open under 2026-04, and ends under 2026-10', () => {
    expect(pointCapEndsBout(BRACKET, BOTH_OUT, config(), EDITION_2026_04)).toBe(false);
    expect(pointCapEndsBout(BRACKET, BOTH_OUT, config(), EDITION_2026_10)).toBe(true);
  });

  it('a Pool bout is a draw under 2026-04, and won by blue under 2026-10', () => {
    expect(roundOutcome(POOL, BOTH_OUT, config(), EDITION_2026_04)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'first_to_points',
    });
    expect(roundOutcome(POOL, BOTH_OUT, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: 'blue',
      endReason: 'first_to_points',
    });
  });

  it('the winner as a registration follows the edition', () => {
    const match = { ...BRACKET, redRegistrationId: 'r', blueRegistrationId: 'b' } as Match;
    expect(getPointCapWinnerRegistrationId(match, BOTH_OUT, config(), EDITION_2026_04)).toBeNull();
    expect(getPointCapWinnerRegistrationId(match, BOTH_OUT, config(), EDITION_2026_10)).toBe('b');
  });

  it('a round of a best-of bout follows the edition it is evaluated with', () => {
    const match = { ...BRACKET, redRegistrationId: 'r', blueRegistrationId: 'b' } as Match;
    const scored = () => BOTH_OUT as never;
    expect(evaluateRound(match, [], config(), EDITION_2026_04, scored)).toMatchObject({
      autoOver: false,
      winnerColor: null,
    });
    expect(evaluateRound(match, [], config(), EDITION_2026_10, scored)).toMatchObject({
      autoOver: true,
      winnerColor: 'blue',
    });
  });
});

describe('a Pool bout that counts down, at its doubles limit', () => {
  it('2026-04 asks the cap first: "first to points", nobody', () => {
    expect(roundOutcome(POOL, WIPED, config(), EDITION_2026_04)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'first_to_points',
    });
  });

  it('2026-04 names a winner when a card left one side behind on the wiped board', () => {
    const carded = { ...WIPED, blueScore: -1 };
    expect(roundOutcome(POOL, carded, config(), EDITION_2026_04)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
  });

  it('2026-10 asks the doubles limit first: a loss for both', () => {
    expect(roundOutcome(POOL, WIPED, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
    expect(roundOutcome(POOL, { ...WIPED, blueScore: -1 }, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
  });
});

describe('a bout that counts up', () => {
  const up = config({ scoringDirection: 'normal' });
  const editions: DecisionEdition[] = [EDITION_2026_04, EDITION_2026_10];

  it.each(editions)('is decided the same by both editions (%o)', (edition) => {
    expect(roundOutcome(POOL, { redScore: 5, blueScore: 5, doubles: 0 }, up, edition)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'first_to_points',
    });
    expect(roundOutcome(POOL, { redScore: 5, blueScore: 3, doubles: 3 }, up, edition)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
    expect(roundOutcome(POOL, { redScore: 2, blueScore: 1, doubles: 3 }, up, edition)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
    expect(pointCapWinnerColor({ redScore: 5, blueScore: 6 }, up, edition)).toBe('blue');
  });
});
