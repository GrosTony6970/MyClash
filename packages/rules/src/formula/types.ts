/**
 * The formula AST and the data it reads — the shape, with no schema.
 *
 * A ruleset may author its scoring as a small expression tree that the runtime
 * evaluates per fighter. The set of legal variables is FIXED and whitelisted, so
 * a formula cannot reference arbitrary data: every variable resolves to a
 * derived stat or a configured constant. That whitelist is the security
 * boundary — CLAUDE.md hard rule 5 forbids eval, Function() and any compiled
 * string, and this AST plus `evaluateFormula` is the sanctioned alternative.
 *
 * The zod schemas that VALIDATE an authored tree stay in `@myclash/rulesets`,
 * declared as `z.ZodType<FormulaNode>` against the types here. Authoring is
 * resolution; evaluating is application.
 */

export const FORMULA_VARIABLE_KEYS = [
  'victories',
  'ties',
  'losses',
  'doubleHits',
  'hitsGiven',
  'hitsReceived',
  'pointsPerVictory',
  'pointsPerTie',
  'pointsPerLoss',
  'doublePenalty',
] as const;

export type VariableKey = (typeof FORMULA_VARIABLE_KEYS)[number];

export type BinaryOperator = '+' | '-' | '*' | '/';

export type FormulaNode =
  | { type: 'literal'; value: number }
  | { type: 'var'; name: VariableKey }
  | { type: 'binop'; op: BinaryOperator; left: FormulaNode; right: FormulaNode };

export interface Tiebreaker {
  variable: VariableKey;
  direction: 'asc' | 'desc';
}

export interface FormulaConstants {
  pointsPerVictory: number;
  pointsPerTie: number;
  pointsPerLoss: number;
  doublePenalty: number;
}

export const DEFAULT_FORMULA_CONSTANTS: FormulaConstants = {
  pointsPerVictory: 3,
  pointsPerTie: 1,
  pointsPerLoss: 0,
  doublePenalty: 0,
};

export interface FormulaConfig {
  scoreFormula: FormulaNode;
  constants: FormulaConstants;
  tiebreakers: Tiebreaker[];
  /**
   * An optional NAMED double-hit penalty, kept out of `scoreFormula` so a
   * ruleset with a nonlinear penalty (e.g. `doubleHits*(doubleHits-1)/3`)
   * needn't inline it. When set, it is evaluated per fighter over `doubleHits`
   * and its result becomes the `doublePenalty` variable the score formula
   * references; when null, `doublePenalty` stays the flat `constants.doublePenalty`.
   *
   * A whitelist KEY (string) or an authored AST — the same `DoublePenaltySpec`
   * shape TF_v1 uses. Typed structurally (`FormulaNode | string`) rather than
   * importing `DoublePenaltySpec`, whose module imports this one — the import
   * would close a cycle.
   */
  doublePenaltyFormula?: FormulaNode | string | null;
}

export interface DerivedFighterStats {
  victories: number;
  ties: number;
  losses: number;
  doubleHits: number;
  hitsGiven: number;
  hitsReceived: number;
}

export const MAX_FORMULA_DEPTH = 32;

export function exceedsMaxFormulaDepth(value: unknown, max = MAX_FORMULA_DEPTH): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    if ((node as { type?: unknown }).type !== 'binop') continue;
    if (depth + 1 >= max) return true;
    const { left, right } = node as { left?: unknown; right?: unknown };
    stack.push({ node: left, depth: depth + 1 }, { node: right, depth: depth + 1 });
  }
  return false;
}

export function isVariableKey(value: string): value is VariableKey {
  return (FORMULA_VARIABLE_KEYS as readonly string[]).includes(value);
}
