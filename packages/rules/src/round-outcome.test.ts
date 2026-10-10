/**
 * Is a round of a best-of bout over by itself, and for whom.
 *
 * `roundOutcome` is the part of `evaluateRound` after the score is known. The
 * server gives it the score of the ruleset's own scorer; the scoring pad gives
 * it the score it shows, so a bout runs its rounds with no network and the two
 * close a round by one function.
 */
import { describe, expect, it } from 'vitest';
import { evaluateRound, roundOutcome, type Match, type MatchFormatConfig } from './index';

function config(over: Partial<MatchFormatConfig> = {}): MatchFormatConfig {
  return {
    pointCap: 5,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 3,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 3, bracket: 3, finals: 3 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
    ...over,
  };
}

const POOL = { phaseType: 'pool' as const, matchNumberLabel: 'M1' };
const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };
const OPEN = { autoOver: false, winnerColor: null, endReason: null };

describe('roundOutcome', () => {
  it('leaves a round open under the cap and under the doubles limit', () => {
    expect(roundOutcome(POOL, { redScore: 4, blueScore: 4, doubles: 2 }, config())).toEqual(OPEN);
  });

  it('closes a round at the cap, for the side that reached it', () => {
    expect(roundOutcome(POOL, { redScore: 5, blueScore: 2, doubles: 0 }, config())).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
    expect(roundOutcome(POOL, { redScore: 1, blueScore: 6, doubles: 0 }, config())).toMatchObject({
      autoOver: true,
      winnerColor: 'blue',
    });
  });

  it('closes a round both reached the cap in, level, only where the phase may end level', () => {
    const level = { redScore: 5, blueScore: 5, doubles: 0 };
    expect(roundOutcome(POOL, level, config())).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'first_to_points',
    });
    // A bracket round cannot end level: it stays open for the next hit.
    expect(roundOutcome(BRACKET, level, config())).toEqual(OPEN);
  });

  it('closes a pool round at the doubles limit, with no winner when the board is wiped', () => {
    expect(roundOutcome(POOL, { redScore: 3, blueScore: 1, doubles: 3 }, config())).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
  });

  it('gives a round at the doubles limit to the leader when the result stands', () => {
    const stands = config({ maxDoubleHitOutcome: 'result_stands' });
    expect(roundOutcome(POOL, { redScore: 3, blueScore: 1, doubles: 3 }, stands)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'max_doubles_result_stands',
    });
  });

  it('applies the doubles limit in a pool and a Swiss round only', () => {
    const atLimit = { redScore: 3, blueScore: 1, doubles: 3 };
    expect(roundOutcome({ ...POOL, phaseType: 'swiss' }, atLimit, config()).autoOver).toBe(true);
    expect(roundOutcome(BRACKET, atLimit, config())).toEqual(OPEN);
    expect(roundOutcome(POOL, atLimit, config({ maxDoubleHits: null }))).toEqual(OPEN);
  });

  it('asks the cap before the doubles limit', () => {
    expect(roundOutcome(POOL, { redScore: 5, blueScore: 1, doubles: 3 }, config())).toMatchObject({
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
  });

  it('reads a reverse score down: the side at zero loses the round', () => {
    const reverse = config({ scoringDirection: 'reverse_zero_loses' });
    expect(roundOutcome(POOL, { redScore: 0, blueScore: 2, doubles: 0 }, reverse)).toMatchObject({
      autoOver: true,
      winnerColor: 'blue',
    });
  });

  it('is what `evaluateRound` answers, on the score its scorer gives', () => {
    const match = { ...BRACKET, redRegistrationId: 'r', blueRegistrationId: 'b' } as Match;
    const score = { redScore: 5, blueScore: 3, doubles: 1 };
    const scored = evaluateRound(match, [], config(), () => score as never);
    expect(scored).toEqual({ score, ...roundOutcome(match, score, config()) });
  });
});
