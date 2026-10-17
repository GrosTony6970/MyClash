/**
 * Is a round of a best-of bout over by itself, and for whom.
 *
 * `roundOutcome` is the part of `evaluateRound` after the score is known. The
 * server gives it the score of the ruleset's own scorer; the scoring pad gives
 * it the score it shows, so a bout runs its rounds with no network and the two
 * close a round by one function.
 */
import { describe, expect, it } from 'vitest';
import {
  EDITION_2026_10,
  evaluateRound,
  roundOutcome,
  type Match,
  type MatchFormatConfig,
} from './index';

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
    expect(
      roundOutcome(POOL, { redScore: 4, blueScore: 4, doubles: 2 }, config(), EDITION_2026_10),
    ).toEqual(OPEN);
  });

  it('closes a round at the cap, for the side that reached it', () => {
    expect(
      roundOutcome(POOL, { redScore: 5, blueScore: 2, doubles: 0 }, config(), EDITION_2026_10),
    ).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
    expect(
      roundOutcome(POOL, { redScore: 1, blueScore: 6, doubles: 0 }, config(), EDITION_2026_10),
    ).toMatchObject({
      autoOver: true,
      winnerColor: 'blue',
    });
  });

  it('closes a round both reached the cap in, level, only where the phase may end level', () => {
    const level = { redScore: 5, blueScore: 5, doubles: 0 };
    expect(roundOutcome(POOL, level, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'first_to_points',
    });
    // A bracket round cannot end level: it stays open for the next hit.
    expect(roundOutcome(BRACKET, level, config(), EDITION_2026_10)).toEqual(OPEN);
  });

  it('closes a pool round at the doubles limit, with no winner when the board is wiped', () => {
    expect(
      roundOutcome(POOL, { redScore: 3, blueScore: 1, doubles: 3 }, config(), EDITION_2026_10),
    ).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
  });

  it('gives a round at the doubles limit to the leader when the result stands', () => {
    const stands = config({ maxDoubleHitOutcome: 'result_stands' });
    expect(
      roundOutcome(POOL, { redScore: 3, blueScore: 1, doubles: 3 }, stands, EDITION_2026_10),
    ).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'max_doubles_result_stands',
    });
  });

  it('applies the doubles limit in a pool and a Swiss round only', () => {
    const atLimit = { redScore: 3, blueScore: 1, doubles: 3 };
    expect(
      roundOutcome({ ...POOL, phaseType: 'swiss' }, atLimit, config(), EDITION_2026_10).autoOver,
    ).toBe(true);
    expect(roundOutcome(BRACKET, atLimit, config(), EDITION_2026_10)).toEqual(OPEN);
    expect(roundOutcome(POOL, atLimit, config({ maxDoubleHits: null }), EDITION_2026_10)).toEqual(
      OPEN,
    );
  });

  it('asks the cap before the doubles limit', () => {
    expect(
      roundOutcome(POOL, { redScore: 5, blueScore: 1, doubles: 3 }, config(), EDITION_2026_10),
    ).toMatchObject({
      winnerColor: 'red',
      endReason: 'first_to_points',
    });
  });

  it('reads a reverse score down: the side at zero loses the round', () => {
    const reverse = config({ scoringDirection: 'reverse_zero_loses' });
    expect(
      roundOutcome(POOL, { redScore: 0, blueScore: 2, doubles: 0 }, reverse, EDITION_2026_10),
    ).toMatchObject({
      autoOver: true,
      winnerColor: 'blue',
    });
  });

  /**
   * A bout that counts down asks the doubles limit FIRST (operator,
   * 2026-10-11). The limit wipes the board to 0 - 0, and there 0 - 0 reads as
   * "both out of points": asked first, the cap ended that bout as a draw.
   */
  describe('in a bout that counts down', () => {
    const down = (over: Partial<MatchFormatConfig> = {}) =>
      config({ scoringDirection: 'reverse_zero_loses', ...over });
    const wiped = { redScore: 0, blueScore: 0, doubles: 3 };

    it('ends a wiped board at the doubles limit as a loss for both, not as a draw at the cap', () => {
      expect(roundOutcome(POOL, wiped, down(), EDITION_2026_10)).toEqual({
        autoOver: true,
        winnerColor: null,
        endReason: 'max_doubles',
      });
    });

    it('ends it as the draw the format asks for, under that reason', () => {
      const draw = down({ maxDoubleHitOutcome: 'draw_zero_scores' });
      expect(roundOutcome(POOL, wiped, draw, EDITION_2026_10)).toEqual({
        autoOver: true,
        winnerColor: null,
        endReason: 'max_doubles_draw',
      });
    });

    it('gives a wiped board with a card on it to nobody', () => {
      // 0 and -1: asked first, the cap named blue the winner of a double loss.
      expect(roundOutcome(POOL, { ...wiped, redScore: -1 }, down(), EDITION_2026_10)).toEqual({
        autoOver: true,
        winnerColor: null,
        endReason: 'max_doubles',
      });
    });

    it('fence: gives a board that stands at the limit to its leader', () => {
      const stands = down({ maxDoubleHitOutcome: 'result_stands' });
      expect(
        roundOutcome(POOL, { redScore: 3, blueScore: 1, doubles: 3 }, stands, EDITION_2026_10),
      ).toEqual({
        autoOver: true,
        winnerColor: 'red',
        endReason: 'max_doubles_result_stands',
      });
    });

    it('fence: under the limit, the fighter at zero still loses at the cap', () => {
      expect(
        roundOutcome(POOL, { redScore: 0, blueScore: 2, doubles: 2 }, down(), EDITION_2026_10),
      ).toEqual({
        autoOver: true,
        winnerColor: 'blue',
        endReason: 'first_to_points',
      });
    });

    it('fence: a bracket has no doubles limit, so its doubles end nothing', () => {
      expect(
        roundOutcome(BRACKET, { redScore: 3, blueScore: 1, doubles: 3 }, down(), EDITION_2026_10),
      ).toEqual(OPEN);
    });
  });

  it('is what `evaluateRound` answers, on the score its scorer gives', () => {
    const match = { ...BRACKET, redRegistrationId: 'r', blueRegistrationId: 'b' } as Match;
    const score = { redScore: 5, blueScore: 3, doubles: 1 };
    const scored = evaluateRound(match, [], config(), EDITION_2026_10, () => score as never);
    expect(scored).toEqual({ score, ...roundOutcome(match, score, config(), EDITION_2026_10) });
  });
});
