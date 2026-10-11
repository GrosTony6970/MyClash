/**
 * A bout that counts down, both fighters out of points on one exchange: what
 * the three scorers answer. The rule itself is tested in `@myclash/rules`
 * (`countdown-zero.test.ts`); this holds that every ruleset's "is the bout
 * over" reaches it with the score its own scorer made.
 *
 * Countdown from 5. Red has 1 point left, blue has 2. Red strikes for 3 and
 * blue answers with an afterblow of 3: red at -2, blue at -1. Blue wins.
 */
import { describe, expect, it } from 'vitest';
import type { Exchange, Match } from './types';
import { DEFAULT_FORMULA_CONSTANTS, Generic_PointsCap, TF_v1, createFormulaRuleset } from './index';
import { DEFAULT_MATCH_FORMAT_CONFIG, getPointCapWinnerRegistrationId } from './match-format';
import { TFv1DefaultConfig } from './tf_v1/config';

const FORMAT = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 5,
  scoringDirection: 'reverse_zero_loses' as const,
  maxDoubleHits: null,
};
const TF_CONFIG = { ...TFv1DefaultConfig, matchFormat: FORMAT };

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

const story = () => [hit('blue', 4), hit('red', 3), hit('red', 3, 3)];
const trueTie = () => [hit('blue', 4), hit('red', 4), hit('red', 2, 2)];
const OVER = { isOver: true, reason: 'first_to_points' };
const OPEN = { isOver: false, reason: null };

describe('TF_v1, both at zero in a bout that counts down', () => {
  const scored = (bout: Match, exchanges: Exchange[]) =>
    TF_v1.computeMatchScore(bout, exchanges, 'full', TF_CONFIG);

  it('ends a bracket bout and a Pool bout for the fighter less far below zero', () => {
    for (const bout of [BRACKET, POOL]) {
      const score = scored(bout, story());
      expect(score).toMatchObject({ redScore: 0, blueScore: 0 });
      expect(TF_v1.isMatchOver(bout, score, TF_CONFIG)).toEqual(OVER);
      expect(getPointCapWinnerRegistrationId(bout, score, FORMAT)).toBe('reg-blue');
    }
  });

  it('ends a true tie as a draw in a Pool', () => {
    const score = scored(POOL, trueTie());
    expect(TF_v1.isMatchOver(POOL, score, TF_CONFIG)).toEqual(OVER);
    expect(getPointCapWinnerRegistrationId(POOL, score, FORMAT)).toBeNull();
  });

  it('keeps a true tie open in a bracket, and the next hit ends it', () => {
    expect(TF_v1.isMatchOver(BRACKET, scored(BRACKET, trueTie()), TF_CONFIG)).toEqual(OPEN);

    const after = scored(BRACKET, [...trueTie(), hit('red', 1)]);
    expect(TF_v1.isMatchOver(BRACKET, after, TF_CONFIG)).toEqual(OVER);
    expect(getPointCapWinnerRegistrationId(BRACKET, after, FORMAT)).toBe('reg-red');
  });
});

describe('the two other scorers read the same rule', () => {
  // Neither has an afterblow (every hit is one fixed value), so neither puts
  // both fighters under zero by itself. Each still answers by the shared rule
  // on a score that says how far under each side went.
  const bothUnder = {
    redScore: 0,
    blueScore: 0,
    redWins: 0,
    blueWins: 0,
    redTargetPoints: 0,
    blueTargetPoints: 0,
    redTimesHit: 0,
    blueTimesHit: 0,
    doubles: 0,
    redBelowZero: 2,
    blueBelowZero: 1,
  };
  const level = { ...bothUnder, redBelowZero: 1 };
  const config = { matchFormat: FORMAT };

  it('Generic_PointsCap', () => {
    expect(Generic_PointsCap.isMatchOver(BRACKET, bothUnder, config)).toEqual(OVER);
    expect(Generic_PointsCap.isMatchOver(BRACKET, level, config)).toEqual(OPEN);
    expect(Generic_PointsCap.isMatchOver(POOL, level, config)).toEqual(OVER);
  });

  it('a club formula ruleset', () => {
    const formula = createFormulaRuleset('Club_X', '1.0.0', 'Club X', {
      scoreFormula: { type: 'var', name: 'victories' },
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers: [],
    });
    expect(formula.isMatchOver(BRACKET, bothUnder, config)).toEqual(OVER);
    expect(formula.isMatchOver(BRACKET, level, config)).toEqual(OPEN);
  });

  it('carries the two numbers from its scorer to its end decision', () => {
    const score = Generic_PointsCap.computeMatchScore(BRACKET, [hit('blue', 1)], 'full', config);
    expect(score).toMatchObject({ redBelowZero: 0, blueBelowZero: 0 });
  });
});
