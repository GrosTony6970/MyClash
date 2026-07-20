/**
 * packages/rulesets/src/tf_v1/double-penalty.ts
 *
 * The double-penalty term of the TF_v1 ranking score, as a WHITELIST.
 *
 * AGENTS.md hard rule #5: no `eval`, no `Function()`. The config carries a KEY,
 * never an expression to evaluate — the key selects one of the implementations
 * below. The keys are the literal expression text so values already stored in
 * `custom_rulesets.tf_config.doublePenaltyFormula` and the
 * `double_penalty_formula` columns keep validating unchanged.
 *
 * Lives in its own module so `config.ts` (the Zod schema) and `score.ts` (the
 * maths) can both reach it without an import cycle.
 */

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

/**
 * Double penalty for `n` doubles. Unknown keys fall back to the federal formula
 * rather than throwing — a standings page must not 500 because a stored config
 * predates a whitelist entry.
 */
export function doublePenalty(
  n: number,
  formula: DoublePenaltyFormula = DEFAULT_DOUBLE_PENALTY_FORMULA,
): number {
  const fn =
    DOUBLE_PENALTY_FORMULAS[formula] ?? DOUBLE_PENALTY_FORMULAS[DEFAULT_DOUBLE_PENALTY_FORMULA];
  return fn(n);
}
