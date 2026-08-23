/**
 * The zod schema for a stored double-penalty rule.
 *
 * The whitelist, the AST, the evaluator and the formatter all moved to
 * `@myclash/rules` — none of them needs zod, and the pad-reachable core is where
 * arithmetic belongs. Only VALIDATING an authored spec is resolution, so only
 * that stayed.
 *
 * The schema is declared `z.ZodType<DoublePenaltySpec>` against the type it does
 * not own, which is the same inversion the formula and match-format splits use.
 */
import { z } from 'zod';

import {
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  FEDERAL_DOUBLE_PENALTY_AST,
  doublePenalty,
  evaluateDoublePenaltyAst,
  formatDoublePenalty,
  isDoublePenaltyAst,
  type DoublePenaltyFormula,
  type DoublePenaltySpec,
} from '@myclash/rules';

import { FormulaNodeSchema } from '../formula/types';

export {
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  FEDERAL_DOUBLE_PENALTY_AST,
  doublePenalty,
  evaluateDoublePenaltyAst,
  formatDoublePenalty,
  isDoublePenaltyAst,
};
export type { DoublePenaltyFormula, DoublePenaltySpec };

export const DoublePenaltySpecSchema: z.ZodType<DoublePenaltySpec> = z.union([
  z.enum(DOUBLE_PENALTY_FORMULA_KEYS),
  FormulaNodeSchema,
]);
