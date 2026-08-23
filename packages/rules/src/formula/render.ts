import type { BinaryOperator, FormulaNode, VariableKey } from './types';
import type { FormulaScope } from './evaluator';

/**
 * How to render a variable node. With `scope`, the fighter's actual value is
 * printed ("5 × 3 + …", the "with your numbers" view); otherwise `label` maps
 * the key to a human string (e.g. an i18n label), falling back to the raw key.
 */
export interface RenderFormulaOptions {
  scope?: FormulaScope;
  label?: (key: VariableKey) => string;
  /** Round substituted scope values to this many decimals. Omit to print as-is. */
  round?: number;
}

// +/- bind looser than */, matching the authoring editor's own renderer so the
// symbolic and substituted views read identically.
function precedence(op: BinaryOperator): number {
  return op === '+' || op === '-' ? 1 : 2;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function renderTerm(key: VariableKey, opts: RenderFormulaOptions): string {
  if (opts.scope) {
    const value = opts.scope[key] ?? 0;
    return String(opts.round != null ? roundTo(value, opts.round) : value);
  }
  return opts.label ? opts.label(key) : key;
}

/**
 * Render a FormulaNode AST to a human-readable infix string, parenthesising only
 * where operator precedence requires it. Shared by the authoring editor (label
 * mode) and the public fighter-derivation view (scope mode).
 */
export function renderFormula(node: FormulaNode, opts: RenderFormulaOptions = {}): string {
  if (node.type === 'literal') return String(node.value);
  if (node.type === 'var') return renderTerm(node.name, opts);
  const left = renderFormula(node.left, opts);
  const right = renderFormula(node.right, opts);
  const leftP =
    node.left.type === 'binop' && precedence(node.op) > precedence(node.left.op)
      ? `(${left})`
      : left;
  // `>=` on the right so `a - (b - c)` and `a / (b / c)` keep their parens —
  // subtraction and division are left-associative.
  const rightP =
    node.right.type === 'binop' && precedence(node.op) >= precedence(node.right.op)
      ? `(${right})`
      : right;
  return `${leftP} ${node.op} ${rightP}`;
}
