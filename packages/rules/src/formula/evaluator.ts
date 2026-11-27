/**
 * packages/rulesets/src/formula/evaluator.ts
 *
 * Pure recursive evaluator for the FormulaRuleset AST.
 *
 * Division by zero divides by 1: `x / 0 = x`. It is TF_v1's rule (a fighter
 * never hit and with no doubles scores the raw top half, `computeScore` in
 * `../tf_v1/score.ts`), so a club formula written like TF_v1 ranks an unbeaten
 * fighter first rather than last. It also keeps every result finite: never
 * NaN or Infinity. Missing variables resolve to 0.
 */
import type { FormulaNode, VariableKey } from './types';

export type FormulaScope = Record<VariableKey, number>;

export function evaluateFormula(node: FormulaNode, scope: FormulaScope): number {
  if (node.type === 'literal') return node.value;
  if (node.type === 'var') return scope[node.name] ?? 0;

  const left = evaluateFormula(node.left, scope);
  const right = evaluateFormula(node.right, scope);
  switch (node.op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? left : left / right;
  }
}
