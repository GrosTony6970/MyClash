import { describe, expect, it } from 'vitest';
import type { Exchange, Match, Registration } from '../types';
import { deriveFighterStats } from './derive-stats';
import { evaluateFormula } from './evaluator';
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

describe('deriveFighterStats', () => {
  function makeMatch(id: string, red: string, blue: string): Match {
    return {
      id,
      redRegistrationId: red,
      blueRegistrationId: blue,
      rulesetCode: 'custom_test',
      rulesetVersion: '1.0.0',
      status: 'completed',
    };
  }

  function exchange(
    matchId: string,
    striker: 'red' | 'blue' | null,
    type: Exchange['type'],
  ): Exchange {
    return {
      id: `${matchId}-${Math.random()}`,
      clientUuid: 'c',
      matchId,
      sequence: 0,
      type,
      occurredAt: '',
      firstStrikerColor: striker,
      firstStrikeValue: striker ? 1 : null,
      afterblowValue: null,
      noExchangeReason: null,
      voided: false,
    };
  }

  it('counts victories, ties, losses and aggregates hits across matches', () => {
    const matches = [
      makeMatch('m1', 'fighter-A', 'fighter-B'),
      makeMatch('m2', 'fighter-A', 'fighter-C'),
      makeMatch('m3', 'fighter-A', 'fighter-D'),
    ];
    const exchanges = new Map<string, Exchange[]>([
      // m1: A scores 2, B scores 1 → A wins
      [
        'm1',
        [
          exchange('m1', 'red', 'clean'),
          exchange('m1', 'red', 'clean'),
          exchange('m1', 'blue', 'clean'),
        ],
      ],
      // m2: A scores 1, C scores 1 → tie
      ['m2', [exchange('m2', 'red', 'clean'), exchange('m2', 'blue', 'clean')]],
      // m3: D scores 2, A scores 0 → A loses, plus 1 double
      [
        'm3',
        [
          exchange('m3', 'blue', 'clean'),
          exchange('m3', 'blue', 'clean'),
          exchange('m3', null, 'double'),
        ],
      ],
    ]);

    const stats = deriveFighterStats('fighter-A', matches, exchanges);
    expect(stats.victories).toBe(1);
    expect(stats.ties).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.doubleHits).toBe(1);
    expect(stats.hitsGiven).toBe(3); // 2 + 1 + 0
    expect(stats.hitsReceived).toBe(4); // 1 + 1 + 2
  });

  it('skips non-completed matches', () => {
    const m = { ...makeMatch('m1', 'A', 'B'), status: 'scheduled' as const };
    const stats = deriveFighterStats('A', [m], new Map());
    expect(stats).toEqual({
      victories: 0,
      ties: 0,
      losses: 0,
      doubleHits: 0,
      hitsGiven: 0,
      hitsReceived: 0,
    });
  });
});

describe('createFormulaRuleset', () => {
  function regOf(id: string, seed: number | null = null): Registration {
    return { id, seed, bibNumber: null };
  }

  function makeMatch(
    id: string,
    red: string,
    blue: string,
    exchanges: Exchange[],
  ): Match & { exchanges: Exchange[] } {
    return {
      id,
      redRegistrationId: red,
      blueRegistrationId: blue,
      rulesetCode: 'custom_test',
      rulesetVersion: '1.0.0',
      status: 'completed',
      exchanges,
    };
  }

  function ex(matchId: string, striker: 'red' | 'blue' | null, type: Exchange['type']): Exchange {
    return {
      id: `${matchId}-${Math.random()}`,
      clientUuid: 'c',
      matchId,
      sequence: 0,
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

    const standings = ruleset.computePoolStandings(
      { id: 'p1', name: 'Pool 1' },
      matches,
      [regOf('A'), regOf('B'), regOf('C')],
      undefined,
    );

    expect(standings[0]?.registrationId).toBe('A');
    expect(standings[0]?.score).toBe(2); // 2 victories - 0 losses
    expect(standings[0]?.rank).toBe(1);
    expect(standings[1]?.registrationId).toBe('B'); // 1 win, 1 loss → 0
    expect(standings[2]?.registrationId).toBe('C'); // 0 wins, 2 losses → -2
    expect(standings[2]?.score).toBe(-2);
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

    const standings = ruleset.computePoolStandings(
      { id: 'p1', name: 'Pool 1' },
      matches,
      [regOf('A'), regOf('B'), regOf('C')],
      undefined,
    );

    // A wins the tie-break with B (0 doubles < 2 doubles)
    expect(standings[0]?.registrationId).toBe('A');
    expect(standings[1]?.registrationId).toBe('B');
    expect(standings[2]?.registrationId).toBe('C');
  });
});
