/**
 * A bout that counts down, at the doubles limit: what the scorers answer.
 *
 * Countdown from 5, doubles limit 3, in a Pool. Red hits once, then three
 * doubles. The limit wipes the board to 0 - 0, and in a bout that counts down
 * 0 - 0 reads as "both out of points": asked first, the point cap ended that
 * bout as a DRAW, where the same bout counting up is a loss for both. The
 * doubles limit is asked first there (operator, 2026-10-11).
 *
 * The rule is `roundOutcome` in `@myclash/rules`. This holds that a bout of one
 * round is decided by that same function, with the score its own scorer made.
 */
import { describe, expect, it } from 'vitest';
import {
  roundOutcome,
  type MatchFormatConfig,
  type MaxDoubleHitOutcome,
  EDITION_2026_04,
  EDITION_2026_10,
} from '@myclash/rules';
import type { Exchange, Match } from './types';
import { DEFAULT_FORMULA_CONSTANTS, TF_v1, createFormulaRuleset } from './index';
import { DEFAULT_MATCH_FORMAT_CONFIG, endOnPointCapOrMaxDoubles } from './match-format';
import { TFv1DefaultConfig } from './tf_v1/config';

const format = (over: Partial<MatchFormatConfig> = {}): MatchFormatConfig => ({
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 5,
  scoringDirection: 'reverse_zero_loses',
  maxDoubleHits: 3,
  ...over,
});

const match = (over: Partial<Match>): Match => ({
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'running',
  ...over,
});
const POOL = match({ phaseType: 'pool', matchNumberLabel: 'L1-P1-M01' });
const BRACKET = match({ phaseType: 'single_elim', matchNumberLabel: 'QF1' });

function row(sequence: number, type: 'clean' | 'double'): Exchange {
  return {
    id: `e${sequence}`,
    clientUuid: `c${sequence}`,
    matchId: 'm1',
    sequence,
    type,
    occurredAt: '2026-10-11T10:00:00.000Z',
    firstStrikerColor: type === 'clean' ? 'red' : null,
    firstStrikeValue: type === 'clean' ? 2 : null,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
  };
}
const STORY = [row(1, 'clean'), row(2, 'double'), row(3, 'double'), row(4, 'double')];

describe('a bout that counts down, at the doubles limit', () => {
  const decided = (matchFormat: MatchFormatConfig) => {
    const config = { ...TFv1DefaultConfig, matchFormat };
    const score = TF_v1.computeMatchScore(POOL, STORY, 'full', config);
    return { score, over: TF_v1.isMatchOver(POOL, score, config) };
  };

  it('TF_v1 ends it as a loss for both, on a wiped board', () => {
    const { score, over } = decided(format());
    expect(score).toMatchObject({ redScore: 0, blueScore: 0, doubles: 3 });
    expect(over).toEqual({ isOver: true, reason: 'max_doubles' });
  });

  it('TF_v1 ends the same bout counting up the same way', () => {
    expect(decided(format({ scoringDirection: 'normal' })).over).toEqual({
      isOver: true,
      reason: 'max_doubles',
    });
  });

  it('TF_v1 ends it as the draw the format asks for, under that reason', () => {
    expect(decided(format({ maxDoubleHitOutcome: 'draw_zero_scores' })).over).toEqual({
      isOver: true,
      reason: 'max_doubles_draw',
    });
  });

  it('a club formula ruleset ends it as a loss for both', () => {
    const formula = createFormulaRuleset(
      'Club_X',
      '1.0.0',
      'Club X',
      {
        scoreFormula: { type: 'var', name: 'victories' },
        constants: DEFAULT_FORMULA_CONSTANTS,
        tiebreakers: [],
      },
      EDITION_2026_10,
    );
    const config = { matchFormat: format() };
    const score = formula.computeMatchScore(POOL, STORY, 'full', config);
    expect(score).toMatchObject({ redScore: 0, blueScore: 0, doubles: 3 });
    expect(formula.isMatchOver(POOL, score, config)).toEqual({
      isOver: true,
      reason: 'max_doubles',
    });
  });
});

/**
 * One owner of the order. A bout of one round and a round of a best-of bout
 * asked "cap, then limit" in two copies, and the two had to be changed
 * together. The bout of one round now asks the round's own function.
 */
describe('endOnPointCapOrMaxDoubles answers what roundOutcome answers', () => {
  const directions = ['normal', 'reverse_zero_loses'] as const;
  const outcomes: MaxDoubleHitOutcome[] = [
    'double_loss_zero_scores',
    'draw_zero_scores',
    'result_stands',
  ];
  const boards = [
    { redScore: 0, blueScore: 0, doubles: 3 },
    { redScore: 3, blueScore: 1, doubles: 3 },
    { redScore: 5, blueScore: 1, doubles: 3 },
    { redScore: 0, blueScore: 2, doubles: 3 },
    { redScore: 0, blueScore: 2, doubles: 0 },
    { redScore: 5, blueScore: 5, doubles: 0 },
    { redScore: 2, blueScore: 2, doubles: 2 },
  ];
  const cases = directions.flatMap((scoringDirection) =>
    outcomes.flatMap((maxDoubleHitOutcome) =>
      [POOL, BRACKET].flatMap((bout) =>
        boards.map((board) => ({ scoringDirection, maxDoubleHitOutcome, bout, board })),
      ),
    ),
  );

  const full = (board: (typeof boards)[number]) => ({
    ...board,
    redWins: 0,
    blueWins: 0,
    redTargetPoints: 0,
    blueTargetPoints: 0,
    redTimesHit: 0,
    blueTimesHit: 0,
  });

  it.each(cases)(
    '$scoringDirection, $maxDoubleHitOutcome, $bout.phaseType, $board',
    ({ scoringDirection, maxDoubleHitOutcome, bout, board }) => {
      const matchFormat = format({ scoringDirection, maxDoubleHitOutcome });
      const score = full(board);
      const round = roundOutcome(bout, score, matchFormat, EDITION_2026_10);
      expect(endOnPointCapOrMaxDoubles(bout, score, matchFormat, EDITION_2026_10)).toEqual({
        isOver: round.autoOver,
        reason: round.endReason,
      });
    },
  );

  it('asks with the edition it is given: before 2026-10-11 the cap came first', () => {
    const wiped = full({ redScore: 0, blueScore: 0, doubles: 3 });
    expect(endOnPointCapOrMaxDoubles(POOL, wiped, format(), EDITION_2026_04)).toEqual({
      isOver: true,
      reason: 'first_to_points',
    });
    expect(endOnPointCapOrMaxDoubles(POOL, wiped, format(), EDITION_2026_10)).toEqual({
      isOver: true,
      reason: 'max_doubles',
    });
  });

  it('still asks the cap before the limit in a bout that counts up', () => {
    const score = full({ redScore: 5, blueScore: 1, doubles: 3 });
    const stands = format({ scoringDirection: 'normal', maxDoubleHitOutcome: 'result_stands' });
    expect(endOnPointCapOrMaxDoubles(POOL, score, stands, EDITION_2026_10)).toEqual({
      isOver: true,
      reason: 'first_to_points',
    });
  });
});
