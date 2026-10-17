/**
 * A bout that counts down, with BOTH fighters out of points on one exchange.
 *
 * Countdown from 5. Red has 1 point left, blue has 2. Red strikes for 3 and
 * blue answers with an afterblow of 3: red is at -2, blue at -1. The board
 * stops at 0 - 0, and the fighter less far below zero wins (operator,
 * 2026-10-11). Both as far below is a true tie: a phase that may end level
 * does, and one that may not goes on until the next hit decides.
 *
 * Before, both sides were held at zero and nothing remembered how far under
 * each went: a Pool bout was a draw whatever the points, and a bracket bout
 * could not end at all.
 */
import { describe, expect, it } from 'vitest';
import type { Exchange, MatchFormatConfig } from './index';
import {
  capLeader,
  computeMatchFormatScore,
  pointCapEndsBout,
  pointCapWinnerColor,
  roundOutcome,
  EDITION_2026_10,
} from './match-format';

function config(over: Partial<MatchFormatConfig> = {}): MatchFormatConfig {
  return {
    pointCap: 5,
    scoringDirection: 'reverse_zero_loses',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: null,
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

let sequence = 0;
function hit(color: 'red' | 'blue', value: number, afterblow?: number): Exchange {
  sequence += 1;
  return {
    id: `e${sequence}`,
    clientUuid: `c${sequence}`,
    matchId: 'm1',
    sequence,
    type: afterblow === undefined ? 'clean' : 'afterblow',
    occurredAt: '2026-10-11T10:00:00.000Z',
    firstStrikerColor: color,
    firstStrikeValue: value,
    afterblowValue: afterblow ?? null,
    noExchangeReason: null,
    voided: false,
  };
}

/** Red has 1 left and blue has 2: blue earned 4, red earned 3. */
const before = () => [hit('blue', 4), hit('red', 3)];
/** Red strikes for 3, blue answers for 3: red at -2, blue at -1. */
const story = () => [...before(), hit('red', 3, 3)];
/** Blue earned 4 and red earned 4, then 2 each way: both at -1. */
const trueTie = () => [hit('blue', 4), hit('red', 4), hit('red', 2, 2)];

const scoreOf = (exchanges: Exchange[], cfg = config()) =>
  computeMatchFormatScore(BRACKET, exchanges, cfg, 'full');

describe('the scorer of a bout that counts down', () => {
  it('stops the board at 0 - 0 and says how far under zero each side went', () => {
    expect(scoreOf(story())).toMatchObject({
      redScore: 0,
      blueScore: 0,
      redBelowZero: 2,
      blueBelowZero: 1,
    });
  });

  it('says zero for a side that is not under zero', () => {
    expect(scoreOf(before())).toMatchObject({
      redScore: 1,
      blueScore: 2,
      redBelowZero: 0,
      blueBelowZero: 0,
    });
  });

  it('gives a bout that counts up the score of before, field for field', () => {
    const score = scoreOf(story(), config({ scoringDirection: 'normal', pointCap: 20 }));
    expect(score).toEqual({
      redScore: 6,
      blueScore: 7,
      redWins: 0,
      blueWins: 0,
      redTargetPoints: 6,
      blueTargetPoints: 7,
      // Red was hit by blue's clean hit, and again in the afterblow.
      redTimesHit: 2,
      blueTimesHit: 1,
      doubles: 0,
    });
    expect(Object.keys(score)).not.toContain('redBelowZero');
    expect(Object.keys(score)).not.toContain('blueBelowZero');
  });
});

describe('capLeader', () => {
  it('names the fighter less far below zero', () => {
    expect(capLeader(scoreOf(story()), config(), EDITION_2026_10)).toBe('blue');
    const mirrored = { redScore: 0, blueScore: 0, redBelowZero: 1, blueBelowZero: 2 };
    expect(capLeader(mirrored, config(), EDITION_2026_10)).toBe('red');
  });

  it('names nobody when both went as far below', () => {
    expect(capLeader(scoreOf(trueTie()), config(), EDITION_2026_10)).toBeNull();
  });

  it('counts a card as the score counts it', () => {
    // Red at -2 by hits. Blue at -1 by hits, and a card took 2 more off its score.
    const carded = { redScore: 0, blueScore: -2, redBelowZero: 2, blueBelowZero: 1 };
    expect(capLeader(carded, config(), EDITION_2026_10)).toBe('red');
  });

  it('does not read the board alone once a card is on it', () => {
    // Red at -3 by hits. Blue at -1 by hits, and a card took 1 more: -2. The
    // board reads 0 and -1, which alone would name red.
    const carded = { redScore: 0, blueScore: -1, redBelowZero: 3, blueBelowZero: 1 };
    expect(capLeader(carded, config(), EDITION_2026_10)).toBe('blue');
    expect(pointCapWinnerColor(carded, config(), EDITION_2026_10)).toBe('blue');
  });

  it('reads the two scores alone as before', () => {
    expect(capLeader({ redScore: 0, blueScore: 0 }, config(), EDITION_2026_10)).toBeNull();
    expect(capLeader({ redScore: 0, blueScore: 2 }, config(), EDITION_2026_10)).toBe('blue');
  });

  it('is the leader on the board in a bout that counts up', () => {
    const up = config({ scoringDirection: 'normal' });
    // Fields a count-up score never carries change nothing there.
    const score = { redScore: 5, blueScore: 3, redBelowZero: 9, blueBelowZero: 0 };
    expect(capLeader(score, up, EDITION_2026_10)).toBe('red');
  });
});

describe('both at zero: who won, and is the bout over', () => {
  it('gives the bout to the fighter less far below zero, in a bracket and in a Pool', () => {
    const score = scoreOf(story());
    expect(pointCapWinnerColor(score, config(), EDITION_2026_10)).toBe('blue');
    expect(pointCapEndsBout(BRACKET, score, config(), EDITION_2026_10)).toBe(true);
    expect(pointCapEndsBout(POOL, score, config(), EDITION_2026_10)).toBe(true);
  });

  it('closes a round the same way', () => {
    const won = { autoOver: true, winnerColor: 'blue', endReason: 'first_to_points' };
    expect(roundOutcome(BRACKET, scoreOf(story()), config(), EDITION_2026_10)).toEqual(won);
    expect(roundOutcome(POOL, scoreOf(story()), config(), EDITION_2026_10)).toEqual(won);
  });

  it('ends a true tie as a draw where the phase may end level', () => {
    const score = scoreOf(trueTie());
    expect(pointCapEndsBout(POOL, score, config(), EDITION_2026_10)).toBe(true);
    expect(pointCapWinnerColor(score, config(), EDITION_2026_10)).toBeNull();
  });

  it('keeps a true tie open in a bracket, and the next hit ends it', () => {
    const tied = scoreOf(trueTie());
    expect(pointCapEndsBout(BRACKET, tied, config(), EDITION_2026_10)).toBe(false);

    const after = scoreOf([...trueTie(), hit('blue', 1)]);
    expect(after).toMatchObject({ redScore: 0, blueScore: 0, redBelowZero: 2, blueBelowZero: 1 });
    expect(pointCapEndsBout(BRACKET, after, config(), EDITION_2026_10)).toBe(true);
    expect(pointCapWinnerColor(after, config(), EDITION_2026_10)).toBe('blue');
  });

  it('still gives a bout with one side at zero to the other side', () => {
    const score = scoreOf([...before(), hit('blue', 3)]);
    expect(score).toMatchObject({ redScore: 0, blueScore: 2, redBelowZero: 2 });
    expect(pointCapWinnerColor(score, config(), EDITION_2026_10)).toBe('blue');
    expect(pointCapEndsBout(BRACKET, score, config(), EDITION_2026_10)).toBe(true);
  });
});
