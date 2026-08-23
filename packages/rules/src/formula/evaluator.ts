/**
 * packages/rulesets/src/formula/evaluator.ts
 *
 * Pure recursive evaluator for the FormulaRuleset AST. Division by zero
 * yields 0 (rather than NaN/Infinity) so a malformed config can't crash the
 * scoring pipeline. Missing variables resolve to 0 — same fallback.
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
      return right === 0 ? 0 : left / right;
  }
}
