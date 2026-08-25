import { describe, expect, it } from 'vitest';
import type { Exchange, Ruleset, ScoredMatch } from '../types';
import { applyRanking } from '@myclash/rules/results';
import { deriveFighterStats, evaluateFormula } from '@myclash/rules';
import { createFormulaRuleset } from './ruleset';
import {
  DEFAULT_FORMULA_CONSTANTS,
  type FormulaConfig,
  type FormulaNode,
  type Tiebreaker,
} from './types';

describe('evaluateFormula', () => {
  const scope = {
    victories: 4,
    ties: 1,
    losses: 1,
    doubleHits: 2,
    hitsGiven: 12,
    hitsReceived: 6,
    pointsPerVictory: 3,
    pointsPerTie: 1,
    pointsPerLoss: 0,
    doublePenalty: 0,
  } as const;

  const lit = (value: number): FormulaNode => ({ type: 'literal', value });
  const v = (name: keyof typeof scope): FormulaNode => ({ type: 'var', name });
  const bin = (op: '+' | '-' | '*' | '/', left: FormulaNode, right: FormulaNode): FormulaNode => ({
    type: 'binop',
    op,
    left,
    right,
  });

  it('evaluates literals and variables', () => {
    expect(evaluateFormula(lit(7), scope)).toBe(7);
    expect(evaluateFormula(v('victories'), scope)).toBe(4);
  });

  it('evaluates all four operators', () => {
    expect(evaluateFormula(bin('+', lit(2), lit(3)), scope)).toBe(5);
    expect(evaluateFormula(bin('-', lit(5), lit(2)), scope)).toBe(3);
    expect(evaluateFormula(bin('*', lit(3), lit(4)), scope)).toBe(12);
    expect(evaluateFormula(bin('/', lit(10), lit(2)), scope)).toBe(5);
  });

  it('returns 0 on division by zero (rather than NaN/Infinity)', () => {
    expect(evaluateFormula(bin('/', lit(5), lit(0)), scope)).toBe(0);
  });

  it('evaluates nested expressions: victories * pointsPerVictory - losses * pointsPerLoss', () => {
    const formula = bin(
      '-',
      bin('*', v('victories'), v('pointsPerVictory')),
      bin('*', v('losses'), v('pointsPerLoss')),
    );
    // 4 * 3 - 1 * 0 = 12
    expect(evaluateFormula(formula, scope)).toBe(12);
  });
});

describe('createFormulaRuleset', () => {
  function makeMatch(id: string, red: string, blue: string, exchanges: Exchange[]): ScoredMatch {
    return {
      id,
      redRegistrationId: red,
      blueRegistrationId: blue,
      endReason: null,
      // No winner, so the board decides — and here it says what the exchanges
      // do. Only clean hits and doubles appear below, and a double has no
      // striker, so counting strikers is the whole score.
      winnerRegistrationId: null,
      redScore: exchanges.filter((e) => e.firstStrikerColor === 'red').length,
      blueScore: exchanges.filter((e) => e.firstStrikerColor === 'blue').length,
      exchanges,
    };
  }

  /**
   * Score, then ORDER by the ruleset's declared chain — which is what the API
   * does. The ruleset used to sort its own rows and the API discarded that
   * ordering, so these assertions now run the path that actually decides
   * placement.
   */
  function rankedIds(ruleset: Ruleset, ids: string[], matches: ScoredMatch[]): string[] {
    const scores = ruleset.scorePoolFighters({
      registrationIds: ids,
      completedMatches: matches,
      afterblowMode: 'full',
      config: {},
    });
    const rows = ids.map((id) => ({
      rank: 0,
      registrationId: id,
      displayName: id,
      club: null,
      status: 'completed' as const,
      stats: { score: scores.get(id) ?? 0 },
    }));
    return applyRanking(rows, ruleset.rankingChain).map((r) => r.registrationId);
  }

  function ex(
    matchId: string,
    striker: 'red' | 'blue' | null,
    type: Exchange['type'],
    seq = 0,
  ): Exchange {
    return {
      id: `${matchId}-${seq}-${striker ?? 'none'}-${type}`,
      clientUuid: 'c',
      matchId,
      sequence: seq,
      type,
      occurredAt: '',
      firstStrikerColor: striker,
      firstStrikeValue: striker ? 1 : null,
      afterblowValue: null,
      noExchangeReason: null,
      voided: false,
    };
  }

  it('ranks fighters using a simple victories-minus-losses formula', () => {
    // Formula: victories - losses
    const formula: FormulaNode = {
      type: 'binop',
      op: '-',
      left: { type: 'var', name: 'victories' },
      right: { type: 'var', name: 'losses' },
    };
    const config: FormulaConfig = {
      scoreFormula: formula,
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers: [{ variable: 'victories', direction: 'desc' }],
    };
    const ruleset = createFormulaRuleset('custom_test', '1.0.0', 'Test', config);

    const matches = [
      makeMatch('m1', 'A', 'B', [ex('m1', 'red', 'clean'), ex('m1', 'red', 'clean')]), // A wins
      makeMatch('m2', 'A', 'C', [ex('m2', 'red', 'clean')]), // A wins
      makeMatch('m3', 'B', 'C', [ex('m3', 'red', 'clean')]), // B wins (red=B)
    ];

    const scores = ruleset.scorePoolFighters({
      registrationIds: ['A', 'B', 'C'],
      completedMatches: matches,
      afterblowMode: 'full',
      config: {},
    });

    expect(scores.get('A')).toBe(2); // 2 victories - 0 losses
    expect(scores.get('B')).toBe(0); // 1 win, 1 loss
    expect(scores.get('C')).toBe(-2); // 0 wins, 2 losses
    expect(rankedIds(ruleset, ['A', 'B', 'C'], matches)).toEqual(['A', 'B', 'C']);
  });

  it('applies tie-breakers when scores are equal', () => {
    // Formula: victories (so two fighters with same wins tie)
    const formula: FormulaNode = { type: 'var', name: 'victories' };
    const tiebreakers: Tiebreaker[] = [
      { variable: 'doubleHits', direction: 'asc' }, // fewer doubles wins
    ];
    const ruleset = createFormulaRuleset('custom_test', '1.0.0', 'Test', {
      scoreFormula: formula,
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers,
    });

    // A: 1 win, 0 doubles
    // B: 1 win, 2 doubles
    // C: 0 wins
    const matches = [
      makeMatch('m1', 'A', 'C', [ex('m1', 'red', 'clean')]),
      makeMatch('m2', 'B', 'C', [
        ex('m2', 'red', 'clean'),
        ex('m2', null, 'double'),
        ex('m2', null, 'double'),
      ]),
    ];

    // A and B both score 1, so the author's doubleHits tiebreaker decides —
    // projected onto the `doubles` column and executed by applyRanking, which is
    // the ONLY sorter now. The ruleset's own sort used to shadow this and then
    // be thrown away.
    const scores = ruleset.scorePoolFighters({
      registrationIds: ['A', 'B', 'C'],
      completedMatches: matches,
      afterblowMode: 'full',
      config: {},
    });
    expect(scores.get('A')).toBe(scores.get('B'));

    const rows = [
      { id: 'A', doubles: 0 },
      { id: 'B', doubles: 2 },
      { id: 'C', doubles: 0 },
    ].map((r) => ({
      rank: 0,
      registrationId: r.id,
      displayName: r.id,
      club: null,
      status: 'completed' as const,
      stats: { score: scores.get(r.id) ?? 0, doubles: r.doubles },
    }));

    expect(applyRanking(rows, ruleset.rankingChain).map((r) => r.registrationId)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('named double-penalty sub-formula (FormulaRuleset scoring)', () => {
  // The penalty is authored in its own field and referenced by the score
  // formula as `doublePenalty`, so a nonlinear penalty need not be inlined in
  // the score. Absent → the flat constant, so a ruleset with no double-hit
  // penalty is unchanged.
  function matchWithDoubles(doubles: number): ScoredMatch {
    const exchanges: Exchange[] = Array.from({ length: doubles }, (_, i) => ({
      id: `d${i}`,
      clientUuid: 'c',
      matchId: 'm1',
      sequence: i,
      type: 'double',
      occurredAt: '',
      firstStrikerColor: null,
      firstStrikeValue: null,
      afterblowValue: null,
      noExchangeReason: null,
      voided: false,
    }));
    return {
      id: 'm1',
      redRegistrationId: 'A',
      blueRegistrationId: 'B',
      winnerRegistrationId: null,
      endReason: null,
      redScore: 0, // doubles only, so the board is level and nobody won it
      blueScore: 0,
      exchanges,
    };
  }

  // score = victories - doublePenalty. With only doubles, victories = 0, so the
  // score is exactly -doublePenalty for that fighter's double count.
  const scoreFormula: FormulaNode = {
    type: 'binop',
    op: '-',
    left: { type: 'var', name: 'victories' },
    right: { type: 'var', name: 'doublePenalty' },
  };
  const constants = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
  function scoreForDoubles(config: FormulaConfig, doubles: number): number {
    const ruleset = createFormulaRuleset('custom_dp', '1.0.0', 'DP', config);
    const scores = ruleset.scorePoolFighters({
      registrationIds: ['A', 'B'],
      completedMatches: [matchWithDoubles(doubles)],
      afterblowMode: 'full',
      config: {},
    });
    return scores.get('A') ?? 0;
  }

  it('applies a linear penalty formula through the doublePenalty variable', () => {
    const config: FormulaConfig = {
      scoreFormula,
      constants,
      tiebreakers: [],
      doublePenaltyFormula: { type: 'var', name: 'doubleHits' },
    };
    // 3 doubles → penalty 3 → score 0 - 3 = -3.
    expect(scoreForDoubles(config, 3)).toBe(-3);
  });

  it('applies a nonlinear AST penalty (doubleHits*(doubleHits-1)/2)', () => {
    const config: FormulaConfig = {
      scoreFormula,
      constants,
      tiebreakers: [],
      doublePenaltyFormula: {
        type: 'binop',
        op: '/',
        left: {
          type: 'binop',
          op: '*',
          left: { type: 'var', name: 'doubleHits' },
          right: {
            type: 'binop',
            op: '-',
            left: { type: 'var', name: 'doubleHits' },
            right: { type: 'literal', value: 1 },
          },
        },
        right: { type: 'literal', value: 2 },
      },
    };
    // 4 doubles → 4*3/2 = 6 → score -6.
    expect(scoreForDoubles(config, 4)).toBe(-6);
  });

  it('accepts a whitelist key form for the penalty', () => {
    const config: FormulaConfig = {
      scoreFormula,
      constants,
      tiebreakers: [],
      doublePenaltyFormula: 'n*(n-1)/3',
    };
    // 3 doubles → 3*2/3 = 2 → score -2.
    expect(scoreForDoubles(config, 3)).toBe(-2);
  });

  it('falls back to the flat constant when no penalty formula is set', () => {
    const config: FormulaConfig = {
      scoreFormula,
      constants: { ...constants, doublePenalty: 5 },
      tiebreakers: [],
    };
    // No formula → doublePenalty is the constant 5, regardless of doubles.
    expect(scoreForDoubles(config, 3)).toBe(-5);
  });
});

/**
 * An org-authored ruleset KEEPS the doubles ceiling that `Generic_PointsCap`
 * does not have — the operator's ruling.
 *
 * It used to delegate `isMatchOver` to Generic, which has no `max_doubles`
 * branch, while its scoring zeroed both fighters at the ceiling. The bout then
 * sat at 0-0 and could not be finished by scoring at all.
 */
describe('createFormulaRuleset — the doubles ceiling', () => {
  const ruleset = createFormulaRuleset('org_custom', '1.0.0', 'Org Custom', {
    scoreFormula: { type: 'var', name: 'victories' },
    constants: DEFAULT_FORMULA_CONSTANTS,
    tiebreakers: [],
  });
  const poolMatch = {
    id: 'm1',
    redRegistrationId: 'reg-red',
    blueRegistrationId: 'reg-blue',
    rulesetCode: 'org_custom',
    rulesetVersion: '1.0.0',
    status: 'running' as const,
    phaseType: 'pool' as const,
  };
  const exchange = (over: Partial<Exchange>): Exchange => ({
    id: 'e1',
    clientUuid: 'u1',
    matchId: 'm1',
    sequence: 1,
    type: 'clean',
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    occurredAt: '2026-01-01T00:00:00Z',
    ...over,
  });
  const doubles = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      exchange({
        id: `d${i}`,
        sequence: i + 10,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
    );

  it('ENDS the bout at the ceiling instead of leaving it stuck at 0-0', () => {
    const exchanges = [exchange({}), ...doubles(4)];
    const score = ruleset.computeMatchScore(poolMatch, exchanges, 'full', {});

    // Scoring still zeroes at the ceiling — that is the rule.
    expect(score).toMatchObject({ redScore: 0, blueScore: 0, doubles: 4 });
    // …and now something ends on it.
    expect(ruleset.isMatchOver(poolMatch, score, {})).toEqual({
      isOver: true,
      reason: 'max_doubles',
    });
  });

  it('keeps the bout open below the ceiling', () => {
    const exchanges = [exchange({}), ...doubles(3)];
    const score = ruleset.computeMatchScore(poolMatch, exchanges, 'full', {});

    expect(score).toMatchObject({ redScore: 1, doubles: 3 });
    expect(ruleset.isMatchOver(poolMatch, score, {}).isOver).toBe(false);
  });

  it('declares that it has the ceiling, unlike Generic_PointsCap', () => {
    expect(ruleset.metadata?.hasMaxDoubles).toBe(true);
  });
});
