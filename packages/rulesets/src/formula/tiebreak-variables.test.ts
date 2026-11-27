/**
 * A tie-breaker can only name a variable that has a standings column to rank
 * on. Before, the schema took any variable and `buildRankingChain` dropped the
 * others in silence; the tie-breaker editor showed them all.
 */
import { describe, expect, it } from 'vitest';
import { createFormulaRuleset } from './ruleset';
import { EDITION_2026_10 } from '../match-format';
import {
  DEFAULT_FORMULA_CONSTANTS,
  FORMULA_VARIABLE_KEYS,
  TIEBREAK_VARIABLES,
  TiebreakerSchema,
} from './types';

describe('TIEBREAK_VARIABLES', () => {
  it('leaves out the constants and points received', () => {
    expect([...TIEBREAK_VARIABLES]).toEqual([
      'victories',
      'ties',
      'losses',
      'doubleHits',
      'hitsGiven',
      'hitsReceived',
    ]);
  });

  it.each(FORMULA_VARIABLE_KEYS.filter((v) => !TIEBREAK_VARIABLES.includes(v as never)))(
    'the schema refuses %s as a tie-breaker',
    (variable) => {
      expect(TiebreakerSchema.safeParse({ variable, direction: 'desc' }).success).toBe(false);
    },
  );

  it('ranks on one column for each tie-breaker variable, after the score', () => {
    const ruleset = createFormulaRuleset(
      'Club_X',
      '1.0.0',
      'Club X',
      {
        scoreFormula: { type: 'var', name: 'victories' },
        constants: DEFAULT_FORMULA_CONSTANTS,
        tiebreakers: TIEBREAK_VARIABLES.map((variable) => ({ variable, direction: 'asc' })),
      },
      EDITION_2026_10,
    );
    expect(ruleset.rankingChain.map((rule) => rule.key)).toEqual([
      'score',
      'W',
      'D',
      'L',
      'doubles',
      'hitsGiven',
      'hitsReceived',
    ]);
  });
});
