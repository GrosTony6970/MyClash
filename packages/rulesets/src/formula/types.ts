/**
 * The zod schemas that VALIDATE an authored formula tree.
 *
 * The SHAPE lives in `@myclash/rules` — the zero-dependency core the scoring pad
 * can reach. Every schema below is declared `z.ZodType<T>` against those types,
 * so zod is inverted OUT of the contract: this file validates INTO a shape it
 * does not own, and a drift between the two is a compile error here.
 *
 * Authoring a formula is resolution and needs zod. Evaluating one is
 * application and needs nothing, which is why `evaluateFormula` moved.
 *
 * The whitelist is the security boundary: CLAUDE.md hard rule 5 forbids eval,
 * Function() and any compiled string. A formula is a Zod-validated AST run by
 * our own closed interpreter over a fixed variable domain.
 */
import { z } from 'zod';

import {
  FORMULA_VARIABLE_KEYS,
  MAX_FORMULA_DEPTH,
  exceedsMaxFormulaDepth,
  isVariableKey,
  DEFAULT_FORMULA_CONSTANTS,
} from '@myclash/rules';
import type {
  BinaryOperator,
  DerivedFighterStats,
  FormulaConfig,
  FormulaConstants,
  FormulaNode,
  Tiebreaker,
  VariableKey,
} from '@myclash/rules';

export {
  FORMULA_VARIABLE_KEYS,
  MAX_FORMULA_DEPTH,
  exceedsMaxFormulaDepth,
  isVariableKey,
  DEFAULT_FORMULA_CONSTANTS,
};
export type {
  BinaryOperator,
  DerivedFighterStats,
  FormulaConfig,
  FormulaConstants,
  FormulaNode,
  Tiebreaker,
  VariableKey,
};

const VariableSchema = z.enum(FORMULA_VARIABLE_KEYS);
const OperatorSchema = z.enum(['+', '-', '*', '/']);

/**
 * One SELF-referential node schema — the getters point back at this same
 * object, so the shape is a cycle rather than a tree.
 *
 * This used to build a fresh child schema per level (`makeFormulaNodeSchema(
 * depth + 1)`), which bounded depth structurally. It validated correctly, but
 * every `binop` held TWO distinct child schemas, each holding two more, 32
 * levels down: 2^32 subschemas. Nothing forced them while parsing — the getters
 * are lazy and real formulas are shallow — but converting the schema to JSON
 * Schema walks every branch, and `SwaggerModule.createDocument` did exactly
 * that. Measured growth was 2x per level (7.7 MB at depth 14), extrapolating to
 * ~2 TB at 32, so the OpenAPI emit could never finish at any heap size.
 *
 * A cycle emits a single `$ref` instead: the whole document is now 0.6 MB.
 */
const FormulaNodeShape: z.ZodType<FormulaNode> = z.union([
  z.object({ type: z.literal('literal'), value: z.number().finite() }),
  z.object({ type: z.literal('var'), name: VariableSchema }),
  z.object({
    type: z.literal('binop'),
    op: OperatorSchema,
    get left() {
      return FormulaNodeShape;
    },
    get right() {
      return FormulaNodeShape;
    },
  }),
]) as z.ZodType<FormulaNode>;

/**
 * The depth check runs on the RAW input, BEFORE the cyclic schema recurses into
 * it. That ordering is load-bearing: parsing a cyclic schema recurses once per
 * node, and zod throws `RangeError: Maximum call stack size exceeded` at around
 * 5 000 levels. A 5 000-deep formula is ~342 KiB of JSON, well inside Fastify's
 * 1 MiB default body limit, so without this an admin could turn a 400 into a
 * 500. Hence `z.unknown()` first, then `.pipe()` into the shape.
 *
 * `.pipe()` costs us the emitted JSON Schema — zod describes a pipe by its
 * INPUT side, which here is `unknown`, i.e. `{}`. That would document
 * `doublePenaltyFormula` as "anything" for every consumer of the typed client.
 * So we hand the shape's own JSON Schema back via `.meta()`, derived from
 * `FormulaNodeShape` rather than written out, so the two cannot drift.
 *
 * The one cost: `z.toJSONSchema` is now reachable at module load, and
 * web-admin imports this package, so its converter lands in that bundle. If
 * that ever matters, move the guarded schema into a server-only module and
 * export the bare shape here instead.
 */
const formulaNodeJsonSchema = z.toJSONSchema(FormulaNodeShape, { io: 'input' });
delete (formulaNodeJsonSchema as { $schema?: unknown }).$schema;

export const FormulaNodeSchema: z.ZodType<FormulaNode> = z
  .unknown()
  .refine((value) => !exceedsMaxFormulaDepth(value), {
    message: `formula nests deeper than ${MAX_FORMULA_DEPTH} levels`,
  })
  .pipe(FormulaNodeShape)
  .meta(formulaNodeJsonSchema) as unknown as z.ZodType<FormulaNode>;

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
  doublePenaltyFormula: z.union([z.string(), FormulaNodeSchema]).nullish(),
});
