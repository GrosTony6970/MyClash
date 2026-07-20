/**
 * packages/rulesets/src/tf_v1/double-penalty.test.ts
 *
 * The double-penalty term accepts two forms — a whitelisted key and an
 * authored AST — and neither one executes input (AGENTS.md hard rule #5).
 *
 * The load-bearing assertion here is BIT-IDENTITY: the federal AST must
 * reproduce the hand-written `n*(n-1)/3` exactly, not approximately. TF_v1
 * standings are ranked on the resulting score, and `tf_v1.fal2026.test.ts`
 * pins published federation results to one decimal — a float that differs in
 * the last bit can flip a tie and therefore a bracket seeding.
 */
import { describe, it, expect } from 'vitest';
import {
  doublePenalty,
  evaluateDoublePenaltyAst,
  isDoublePenaltyAst,
  formatDoublePenalty,
  DoublePenaltySpecSchema,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_VARIABLE,
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  FEDERAL_DOUBLE_PENALTY_AST,
  type DoublePenaltySpec,
} from './double-penalty';
import type { FormulaNode } from '../formula/types';

const federal = DOUBLE_PENALTY_FORMULAS[DEFAULT_DOUBLE_PENALTY_FORMULA];

describe('FEDERAL_DOUBLE_PENALTY_AST — bit-identity gate', () => {
  it('reproduces the hardcoded n*(n-1)/3 bit-for-bit', () => {
    // Object.is, not toBeCloseTo: this is the gate the plan requires, and it
    // is also what catches -0 (see below).
    for (let n = 0; n <= 200; n += 1) {
      expect(Object.is(evaluateDoublePenaltyAst(FEDERAL_DOUBLE_PENALTY_AST, n), federal(n))).toBe(
        true,
      );
    }
  });

  it('reproduces it for large double counts', () => {
    for (const n of [1_000, 10_000, 1_000_000]) {
      expect(Object.is(evaluateDoublePenaltyAst(FEDERAL_DOUBLE_PENALTY_AST, n), federal(n))).toBe(
        true,
      );
    }
  });

  it('DOCUMENTED DIVERGENCE: the key form clamps fractional n, the AST does not', () => {
    // The hand-written formulas guard with `n <= 1 ? 0`, which is a CLAMP, not
    // a restatement of the closed form: on 0 < n < 1 the closed form is
    // negative and the guard returns 0. The AST grammar has no comparison
    // operator, so it cannot reproduce the clamp — it returns the negative.
    //
    // This is unreachable in production: `n` is a count of double-hit
    // exchanges (`computeAggregates` increments it by 1), so the domain is the
    // non-negative integers, where the two forms are bit-identical (asserted
    // above). Pinned here so the divergence is a recorded decision rather than
    // a latent surprise if the domain ever widens.
    expect(federal(0.5)).toBe(0);
    expect(evaluateDoublePenaltyAst(FEDERAL_DOUBLE_PENALTY_AST, 0.5)).toBeCloseTo(-0.0833, 4);
  });

  it('normalises -0 to 0 at n = 0', () => {
    // (0 * -1) / 3 is -0, and Object.is(-0, 0) is false. Without the
    // normalisation this leaks a negative zero into every stored standing and
    // breaks `expect(doublePenalty(0)).toBe(0)`.
    const raw = evaluateDoublePenaltyAst(FEDERAL_DOUBLE_PENALTY_AST, 0);
    expect(raw).toBe(0);
    expect(Object.is(raw, -0)).toBe(false);
  });

  it('renders in the federation’s published notation', () => {
    expect(formatDoublePenalty(FEDERAL_DOUBLE_PENALTY_AST)).toBe('(n * (n - 1)) / 3');
    expect(formatDoublePenalty('n*(n-1)/3')).toBe('n*(n-1)/3');
  });
});

describe('doublePenalty — dual form dispatch', () => {
  it('still honours every whitelisted key', () => {
    expect(doublePenalty(4, 'n*(n-1)/3')).toBe(4);
    expect(doublePenalty(4, 'n*(n-1)/2')).toBe(6);
    expect(doublePenalty(4, 'n')).toBe(4);
    expect(doublePenalty(4, '0')).toBe(0);
  });

  it('evaluates an authored AST', () => {
    // A club house rule: half a penalty point per double, linear.
    const houseRule: FormulaNode = {
      type: 'binop',
      op: '/',
      left: { type: 'var', name: DOUBLE_PENALTY_VARIABLE },
      right: { type: 'literal', value: 2 },
    };
    expect(doublePenalty(0, houseRule)).toBe(0);
    expect(doublePenalty(5, houseRule)).toBe(2.5);
  });

  it('falls back to the federal formula when an AST overflows to infinity', () => {
    // A standings page must not rank on Infinity because of a stored config.
    const overflow: FormulaNode = {
      type: 'binop',
      op: '*',
      left: { type: 'literal', value: Number.MAX_VALUE },
      right: { type: 'literal', value: Number.MAX_VALUE },
    };
    expect(doublePenalty(4, overflow)).toBe(federal(4));
  });

  it('yields 0 rather than NaN when an AST divides by zero', () => {
    // evaluateFormula already maps x/0 to 0; assert the contract holds here so
    // a house rule like n/(n-1) at n=1 cannot poison the denominator.
    const divByZero: FormulaNode = {
      type: 'binop',
      op: '/',
      left: { type: 'var', name: DOUBLE_PENALTY_VARIABLE },
      right: {
        type: 'binop',
        op: '-',
        left: { type: 'var', name: DOUBLE_PENALTY_VARIABLE },
        right: { type: 'literal', value: 1 },
      },
    };
    expect(doublePenalty(1, divByZero)).toBe(0);
  });

  it('narrows keys and ASTs correctly', () => {
    expect(isDoublePenaltyAst('n*(n-1)/3')).toBe(false);
    expect(isDoublePenaltyAst(FEDERAL_DOUBLE_PENALTY_AST)).toBe(true);
  });
});

describe('DoublePenaltySpecSchema — a strict superset of the key enum', () => {
  it('accepts every legacy key', () => {
    for (const key of Object.keys(DOUBLE_PENALTY_FORMULAS)) {
      expect(DoublePenaltySpecSchema.parse(key)).toBe(key);
    }
  });

  it('accepts a well-formed AST', () => {
    expect(DoublePenaltySpecSchema.parse(FEDERAL_DOUBLE_PENALTY_AST)).toEqual(
      FEDERAL_DOUBLE_PENALTY_AST,
    );
  });

  it('rejects a free-text expression', () => {
    // The whole point: authoring goes through the AST, never through a string
    // that something downstream might be tempted to evaluate.
    expect(() => DoublePenaltySpecSchema.parse('n*(n-1)/7')).toThrow();
    expect(() => DoublePenaltySpecSchema.parse('process.exit(1)')).toThrow();
  });

  it('rejects an AST referencing a variable outside the whitelist', () => {
    const bogus = { type: 'var', name: 'n' } as unknown as DoublePenaltySpec;
    expect(() => DoublePenaltySpecSchema.parse(bogus)).toThrow();
  });

  it('rejects a malformed node', () => {
    expect(() => DoublePenaltySpecSchema.parse({ type: 'binop', op: '**' })).toThrow();
    expect(() => DoublePenaltySpecSchema.parse({ type: 'literal', value: Infinity })).toThrow();
  });
});
