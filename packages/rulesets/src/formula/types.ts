/**
 * packages/rulesets/src/formula/types.ts
 *
 * Types for the data-driven FormulaRuleset: a small AST that the runtime
 * evaluates per fighter against derived stats + per-ruleset constants.
 *
 * The set of legal variables is fixed (whitelisted) so the formula cannot
 * reference arbitrary data — every variable maps to either a derived stat
 * or a configured constant.
 */
import { z } from 'zod';

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
}

export interface DerivedFighterStats {
  victories: number;
  ties: number;
  losses: number;
  doubleHits: number;
  hitsGiven: number;
  hitsReceived: number;
}

// ── Zod schemas (used by DTO validation and configSchema on the Ruleset) ──

const VariableSchema = z.enum(FORMULA_VARIABLE_KEYS);
const OperatorSchema = z.enum(['+', '-', '*', '/']);

const MAX_FORMULA_DEPTH = 32;

function makeFormulaNodeSchema(depth = 0): z.ZodType<FormulaNode> {
  if (depth >= MAX_FORMULA_DEPTH) {
    return z.never() as unknown as z.ZodType<FormulaNode>;
  }
  return z.union([
    z.object({ type: z.literal('literal'), value: z.number().finite() }),
    z.object({ type: z.literal('var'), name: VariableSchema }),
    z.object({
      type: z.literal('binop'),
      op: OperatorSchema,
      get left() {
        return makeFormulaNodeSchema(depth + 1);
      },
      get right() {
        return makeFormulaNodeSchema(depth + 1);
      },
    }),
  ]) as z.ZodType<FormulaNode>;
}

export const FormulaNodeSchema: z.ZodType<FormulaNode> = makeFormulaNodeSchema();

export const TiebreakerSchema: z.ZodType<Tiebreaker> = z.object({
  variable: VariableSchema,
  direction: z.enum(['asc', 'desc']),
});

export const FormulaConstantsSchema: z.ZodType<FormulaConstants> = z.object({
  pointsPerVictory: z.number().finite(),
  pointsPerTie: z.number().finite(),
  pointsPerLoss: z.number().finite(),
  doublePenalty: z.number().finite(),
});

export const FormulaConfigSchema: z.ZodType<FormulaConfig> = z.object({
  scoreFormula: FormulaNodeSchema,
  constants: FormulaConstantsSchema,
  tiebreakers: z.array(TiebreakerSchema).max(16),
});

export function isVariableKey(value: string): value is VariableKey {
  return (FORMULA_VARIABLE_KEYS as readonly string[]).includes(value);
}
