import { describe, it, expect } from 'vitest';
import {
  canonicalizeScoringBehaviour,
  stableStringify,
  type CodedScoringBehaviour,
  type FormulaScoringBehaviour,
} from '../src/content-hash';

const codedBase: CodedScoringBehaviour = {
  kind: 'coded',
  engineCode: 'TF_v1',
  engineVersion: '1.0.0',
  grammar: {
    targets: [
      { name: 'deep', value: 2 },
      { name: 'shallow', value: 1 },
    ],
    hasAfterblow: true,
    afterblowValuation: 'fixed',
    afterblowFixedValue: 1,
  },
  matchFormat: { pointCap: 10, bestOf: 1, scoringDirection: 'up' },
  afterblowMode: 'deductive',
  winBonus: 3,
  doublePenaltyFormula: 'n_times_n_minus_1_over_3',
  forfeitPolicy: { reasons: { black_card_1: { tournamentState: 'match_only' } } },
};

const formulaBase: FormulaScoringBehaviour = {
  kind: 'formula',
  grammar: {
    targets: null,
    hasAfterblow: false,
    afterblowValuation: null,
    afterblowFixedValue: null,
  },
  matchFormat: { pointCap: 5 },
  afterblowMode: null,
  scoreFormula: {
    type: 'binop',
    op: '+',
    left: { type: 'var', name: 'victories' },
    right: { type: 'literal', value: 1 },
  },
  constants: { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 },
  tiebreakers: [
    { variable: 'victories', direction: 'desc' },
    { variable: 'hitsReceived', direction: 'asc' },
  ],
  doublePenaltyFormula: null,
};

const hashOf = (input: CodedScoringBehaviour | FormulaScoringBehaviour) =>
  stableStringify(canonicalizeScoringBehaviour(input));

describe('stableStringify', () => {
  it('is independent of object key insertion order', () => {
    expect(stableStringify({ b: 1, a: 2, c: { y: 1, x: 2 } })).toBe(
      stableStringify({ c: { x: 2, y: 1 }, a: 2, b: 1 }),
    );
  });

  it('preserves array order (order is significant)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('serialises undefined and null identically to null', () => {
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify({ a: undefined })).toBe(stableStringify({ a: null }));
  });
});

describe('canonicalizeScoringBehaviour — coded', () => {
  it('is stable under target reordering (targets are behaviour, order is not)', () => {
    const reordered: CodedScoringBehaviour = {
      ...codedBase,
      grammar: {
        ...codedBase.grammar,
        targets: [
          { name: 'shallow', value: 1 },
          { name: 'deep', value: 2 },
        ],
      },
    };
    expect(hashOf(reordered)).toBe(hashOf(codedBase));
  });

  it('changes when winBonus changes', () => {
    expect(hashOf({ ...codedBase, winBonus: 2 })).not.toBe(hashOf(codedBase));
  });

  it('changes when afterblowMode changes (a tournament-level score determinant)', () => {
    expect(hashOf({ ...codedBase, afterblowMode: 'full' })).not.toBe(hashOf(codedBase));
  });

  it('changes when a matchFormat end-condition changes', () => {
    expect(hashOf({ ...codedBase, matchFormat: { pointCap: 15 } })).not.toBe(hashOf(codedBase));
  });

  it('is stable under matchFormat key-order + absent-key normalisation', () => {
    const a = hashOf({
      ...codedBase,
      matchFormat: { bestOf: 1, pointCap: 10, scoringDirection: 'up' },
    });
    const b = hashOf({
      ...codedBase,
      matchFormat: { scoringDirection: 'up', pointCap: 10, bestOf: 1 },
    });
    expect(a).toBe(b);
  });

  it('folds the engine code+version into the fingerprint', () => {
    expect(hashOf({ ...codedBase, engineVersion: '2.0.0' })).not.toBe(hashOf(codedBase));
  });
});

describe('canonicalizeScoringBehaviour — formula', () => {
  it('changes when the score formula AST changes', () => {
    const changed: FormulaScoringBehaviour = {
      ...formulaBase,
      scoreFormula: { type: 'var', name: 'victories' },
    };
    expect(hashOf(changed)).not.toBe(hashOf(formulaBase));
  });

  it('changes when a constant changes', () => {
    expect(
      hashOf({ ...formulaBase, constants: { ...formulaBase.constants, pointsPerVictory: 5 } }),
    ).not.toBe(hashOf(formulaBase));
  });

  it('changes when tiebreaker ORDER changes (precedence is significant)', () => {
    const swapped: FormulaScoringBehaviour = {
      ...formulaBase,
      tiebreakers: [
        { variable: 'hitsReceived', direction: 'asc' },
        { variable: 'victories', direction: 'desc' },
      ],
    };
    expect(hashOf(swapped)).not.toBe(hashOf(formulaBase));
  });
});

describe('coded vs formula never collide', () => {
  it('distinguishes kinds even with otherwise-empty content', () => {
    const coded = hashOf({
      kind: 'coded',
      engineCode: 'X',
      engineVersion: '1',
      grammar: {
        targets: null,
        hasAfterblow: false,
        afterblowValuation: null,
        afterblowFixedValue: null,
      },
      matchFormat: null,
      afterblowMode: null,
      winBonus: null,
      doublePenaltyFormula: null,
      forfeitPolicy: null,
    });
    const formula = hashOf({
      kind: 'formula',
      grammar: {
        targets: null,
        hasAfterblow: false,
        afterblowValuation: null,
        afterblowFixedValue: null,
      },
      matchFormat: null,
      afterblowMode: null,
      scoreFormula: null,
      constants: { pointsPerVictory: 0, pointsPerTie: 0, pointsPerLoss: 0, doublePenalty: 0 },
      tiebreakers: [],
      doublePenaltyFormula: null,
    });
    expect(coded).not.toBe(formula);
  });
});
