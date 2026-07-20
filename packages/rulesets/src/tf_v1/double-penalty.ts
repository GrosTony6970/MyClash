/**
 * packages/rulesets/src/tf_v1/double-penalty.ts
 *
 * The double-penalty term of the TF_v1 ranking score.
 *
 * AGENTS.md hard rule #5: no `eval`, no `Function()`. Two forms are accepted,
 * and NEITHER of them executes input:
 *
 *   1. A whitelisted KEY (`'n*(n-1)/3'`, …) selecting one of the hand-written
 *      implementations below. The keys are the literal expression text so
 *      values already stored in `custom_rulesets.tf_config.doublePenaltyFormula`
 *      and the `double_penalty_formula` columns keep validating unchanged.
 *   2. An authored AST (`FormulaNode`) evaluated by our own `evaluateFormula` —
 *      a closed recursive interpreter over a Zod-validated tree with a fixed
 *      variable domain. This is the repo's sanctioned pattern for user-authored
 *      formulas (it is what `FormulaRuleset` already uses for `scoreFormula`),
 *      and it is what lets a club express a house rule without shipping code.
 *
 * The key path is deliberately left untouched rather than re-expressed as an
 * AST: `'n'` is `Math.max(0, n)`, which the AST grammar cannot express, and
 * re-routing the federal default through the evaluator would change `-0`
 * behaviour at `n = 0` (see `evaluateDoublePenaltyAst`).
 *
 * Lives in its own module so `config.ts` (the Zod schema) and `score.ts` (the
 * maths) can both reach it without an import cycle.
 */
import { z } from 'zod';
import { evaluateFormula, type FormulaScope } from '../formula/evaluator';
import {
  FORMULA_VARIABLE_KEYS,
  FormulaNodeSchema,
  type FormulaNode,
  type VariableKey,
} from '../formula/types';

export const DOUBLE_PENALTY_FORMULAS = {
  /** Federal FFAMHE rule — ARCHITECTURE.md §6.2. */
  'n*(n-1)/3': (n: number) => (n <= 1 ? 0 : (n * (n - 1)) / 3),
  'n*(n-1)/2': (n: number) => (n <= 1 ? 0 : (n * (n - 1)) / 2),
  /** Linear: one penalty point per double. */
  n: (n: number) => Math.max(0, n),
  /** Doubles are counted but never penalise the score. */
  '0': () => 0,
} as const satisfies Record<string, (n: number) => number>;

export type DoublePenaltyFormula = keyof typeof DOUBLE_PENALTY_FORMULAS;

export const DEFAULT_DOUBLE_PENALTY_FORMULA: DoublePenaltyFormula = 'n*(n-1)/3';

/** Non-empty tuple, the shape z.enum() requires. */
export const DOUBLE_PENALTY_FORMULA_KEYS = Object.keys(DOUBLE_PENALTY_FORMULAS) as [
  DoublePenaltyFormula,
  ...DoublePenaltyFormula[],
];

// ── Authored AST form ─────────────────────────────────────────────────────────

/**
 * The free variable of a double-penalty AST — i.e. TF_v1's `n`.
 *
 * `doubleHits` is reused rather than introducing an `n` variable: it already
 * means "number of double hits", and `FORMULA_VARIABLE_KEYS` is the palette
 * `FormulaEditor` renders for EVERY custom ruleset's score formula, so adding
 * `n` there would leak a TF_v1-only concept into the generic editor.
 * `doublePenalty` was not reused — it is already taken, as a flat numeric
 * constant on `FormulaConstants`.
 */
export const DOUBLE_PENALTY_VARIABLE: VariableKey = 'doubleHits';

/**
 * The federal formula `n*(n-1)/3` expressed as an AST.
 *
 * Operand order matches the hand-written implementation exactly — `(n * (n-1))`
 * then `/ 3` — so the two are IEEE-754 bit-identical for every finite `n`
 * (asserted over a wide sweep in `double-penalty.test.ts`). It is exported so
 * the authoring UI can seed a "start from the federal rule" AST.
 */
export const FEDERAL_DOUBLE_PENALTY_AST: FormulaNode = {
  type: 'binop',
  op: '/',
  left: {
    type: 'binop',
    op: '*',
    left: { type: 'var', name: DOUBLE_PENALTY_VARIABLE },
    right: {
      type: 'binop',
      op: '-',
      left: { type: 'var', name: DOUBLE_PENALTY_VARIABLE },
      right: { type: 'literal', value: 1 },
    },
  },
  right: { type: 'literal', value: 3 },
};

/**
 * A stored double-penalty rule: either a whitelisted key or an authored AST.
 * Widening key → key|AST is a strict superset, so every stored value keeps
 * validating.
 */
export type DoublePenaltySpec = DoublePenaltyFormula | FormulaNode;

export const DoublePenaltySpecSchema: z.ZodType<DoublePenaltySpec> = z.union([
  z.enum(DOUBLE_PENALTY_FORMULA_KEYS),
  FormulaNodeSchema,
]);

/** Narrow a spec to its AST form. Strings are keys; objects are ASTs. */
export function isDoublePenaltyAst(spec: DoublePenaltySpec): spec is FormulaNode {
  return typeof spec === 'object' && spec !== null;
}

/** All formula variables zeroed — the base every penalty scope is built on. */
const ZERO_SCOPE: FormulaScope = Object.fromEntries(
  FORMULA_VARIABLE_KEYS.map((key) => [key, 0]),
) as FormulaScope;

/**
 * Evaluate an authored double-penalty AST for `n` doubles.
 *
 * Two normalisations, both load-bearing:
 *  - **`-0` → `0`.** The federal AST at `n = 0` computes `(0 * -1) / 3`, which
 *    is `-0`. `Object.is(-0, 0)` is false, so a raw result would break every
 *    `toBe(0)` assertion and leak a negative zero into stored standings. The
 *    hand-written formulas dodge this with their `n <= 1 ? 0` guard.
 *  - **Non-finite → federal.** Same posture as an unknown key below: a
 *    standings page must not 500 (or rank on `NaN`) because of a stored config.
 *    `evaluateFormula` already maps division-by-zero to 0, so this only catches
 *    overflow to ±Infinity.
 */
export function evaluateDoublePenaltyAst(ast: FormulaNode, n: number): number {
  const raw = evaluateFormula(ast, { ...ZERO_SCOPE, [DOUBLE_PENALTY_VARIABLE]: n });
  if (!Number.isFinite(raw)) return DOUBLE_PENALTY_FORMULAS[DEFAULT_DOUBLE_PENALTY_FORMULA](n);
  return raw === 0 ? 0 : raw;
}

/**
 * Render a spec as the human-readable expression admin surfaces display.
 *
 * Keys are already their own expression text, so they pass through verbatim.
 * ASTs are rendered in TF_v1's published notation — the free variable prints as
 * `n`, not `doubleHits` — which makes an authored house rule read like the
 * federal one it was forked from.
 */
export function formatDoublePenalty(spec: DoublePenaltySpec): string {
  return isDoublePenaltyAst(spec) ? renderNode(spec, true) : spec;
}

function renderNode(node: FormulaNode, isRoot = false): string {
  if (node.type === 'literal') return String(node.value);
  if (node.type === 'var') return node.name === DOUBLE_PENALTY_VARIABLE ? 'n' : node.name;
  // Parenthesise every non-root binop rather than tracking precedence: this is
  // display text, and unambiguous beats terse.
  const rendered = `${renderNode(node.left)} ${node.op} ${renderNode(node.right)}`;
  return isRoot ? rendered : `(${rendered})`;
}

/**
 * Double penalty for `n` doubles. Unknown keys fall back to the federal formula
 * rather than throwing — a standings page must not 500 because a stored config
 * predates a whitelist entry.
 */
export function doublePenalty(
  n: number,
  formula: DoublePenaltySpec = DEFAULT_DOUBLE_PENALTY_FORMULA,
): number {
  if (isDoublePenaltyAst(formula)) return evaluateDoublePenaltyAst(formula, n);
  const fn =
    DOUBLE_PENALTY_FORMULAS[formula] ?? DOUBLE_PENALTY_FORMULAS[DEFAULT_DOUBLE_PENALTY_FORMULA];
  return fn(n);
}
