import { describe, expect, it } from 'vitest';
import type { FormulaNode } from './types';
import { renderFormula } from './render';

const v = (name: string): FormulaNode => ({ type: 'var', name: name as never });
const lit = (value: number): FormulaNode => ({ type: 'literal', value });
const op = (o: '+' | '-' | '*' | '/', left: FormulaNode, right: FormulaNode): FormulaNode => ({
  type: 'binop',
  op: o,
  left,
  right,
});

// (victories * pointsPerVictory) / (hitsReceived + doublePenalty)
const TF = op(
  '/',
  op('*', v('victories'), v('pointsPerVictory')),
  op('+', v('hitsReceived'), v('doublePenalty')),
);

describe('renderFormula', () => {
  it('renders raw variable keys by default, parenthesising only by precedence', () => {
    // * binds tighter than /, so the left product needs no parens; the right sum
    // does because + binds looser than /.
    expect(renderFormula(TF)).toBe('victories * pointsPerVictory / (hitsReceived + doublePenalty)');
  });

  it('maps variables through a label callback (symbolic view)', () => {
    expect(renderFormula(TF, { label: (k) => k.toUpperCase() })).toBe(
      'VICTORIES * POINTSPERVICTORY / (HITSRECEIVED + DOUBLEPENALTY)',
    );
  });

  it('substitutes a fighter scope (the "with your numbers" view)', () => {
    const scope = {
      victories: 5,
      pointsPerVictory: 3,
      hitsReceived: 12,
      doublePenalty: 2,
    } as never;
    expect(renderFormula(TF, { scope })).toBe('5 * 3 / (12 + 2)');
  });

  it('rounds substituted leaf values', () => {
    const node = op('+', v('victories'), lit(1));
    expect(renderFormula(node, { scope: { victories: 4.4285 } as never, round: 2 })).toBe(
      '4.43 + 1',
    );
  });

  it('keeps parens on a right-nested same-precedence op (left-associative)', () => {
    // a - (b - c) must keep its parens; a - b - c must not.
    expect(renderFormula(op('-', v('a'), op('-', v('b'), v('c'))))).toBe('a - (b - c)');
    expect(renderFormula(op('-', op('-', v('a'), v('b')), v('c')))).toBe('a - b - c');
  });

  it('renders a bare literal and a bare variable', () => {
    expect(renderFormula(lit(3))).toBe('3');
    expect(renderFormula(v('victories'))).toBe('victories');
  });
});
