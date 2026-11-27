import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';
import {
  BUILT_IN_RULESETS,
  DEFAULT_FORMULA_CONSTANTS,
  EDITION_2026_10,
  FORMULA_VARIABLE_KEYS,
  createFormulaRuleset,
} from '@myclash/rulesets';
import { rankingKeyLabel, rankingKeyLabelKey } from './ranking-key-label';

function resolve(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, part) => {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    return (cursor as Record<string, unknown>)[part];
  }, tree);
}

/**
 * Every key a ranking chain can hold: each built-in's own chain, and the chain a
 * club formula ruleset builds when every variable is a tie-breaker (score first,
 * then each variable that maps to a standings column).
 */
function everyRankingKey(): string[] {
  const formula = createFormulaRuleset(
    'Club_X',
    '1.0.0',
    'Club X',
    {
      scoreFormula: { type: 'var', name: 'victories' },
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers: FORMULA_VARIABLE_KEYS.map((variable) => ({ variable, direction: 'desc' })),
    },
    EDITION_2026_10,
  );
  const chains = [...BUILT_IN_RULESETS, formula].map((ruleset) => ruleset.rankingChain);
  return [...new Set(chains.flat().map((rule) => rule.key))].sort();
}

describe('rankingKeyLabel', () => {
  it('reads the key from i18n', () => {
    expect(rankingKeyLabel('score', (key) => `<<${key}>>`)).toBe(
      '<<admin.rulesets.rankingKey_score>>',
    );
  });

  it('finds the keys a ranking chain holds, score first among them', () => {
    expect(everyRankingKey()).toContain('score');
  });

  it.each(everyRankingKey())('%s has EN and FR copy', (key) => {
    const path = rankingKeyLabelKey(key);
    expect(typeof resolve(en, path)).toBe('string');
    expect(typeof resolve(fr, path)).toBe('string');
  });
});
