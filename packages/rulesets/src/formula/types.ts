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

/** The four arithmetic operators a formula may use, as data. */
const FORMULA_OPERATORS = ['+', '-', '*', '/'] as const satisfies readonly BinaryOperator[];
const OperatorSchema = z.enum(FORMULA_OPERATORS);

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
export const FormulaNodeShape: z.ZodType<FormulaNode> = z.union([
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
 * So we hand the shape's own JSON Schema back via `.meta()`.
 *
 * ── Why this is written out and not derived ─────────────────────────────────
 * It used to be `z.toJSONSchema(FormulaNodeShape, { io: 'input' })`, evaluated
 * at MODULE LOAD. That put zod's JSON-Schema converter — and a run of it — into
 * every bundle importing this package. `@myclash/rulesets` is a CommonJS barrel
 * with no tree-shaking, so importing one constant from it (web-admin imports
 * `DEFAULT_FORMULA_CONSTANTS`, `FORMULA_VARIABLE_KEYS`, `MAX_TARGETS` and more
 * across twenty files) pulled the converter into the browser to build a
 * document only the OpenAPI emit reads.
 *
 * Writing it out normally means a second copy that can drift. It does not here,
 * for two reasons: both enums below are the SAME arrays the schema is built
 * from, so the parts that actually change cannot disagree; and
 * `formula-node-schema.test.ts` asserts this constant still deep-equals what
 * `z.toJSONSchema` derives from the shape. The converter runs in the test,
 * which is the one place it is needed.
 */
const FORMULA_NODE_JSON_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'literal' },
        value: { type: 'number' },
      },
      required: ['type', 'value'],
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'var' },
        name: { type: 'string', enum: [...FORMULA_VARIABLE_KEYS] },
      },
      required: ['type', 'name'],
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'binop' },
        op: { type: 'string', enum: [...FORMULA_OPERATORS] },
        // The cycle, as the one `$ref` that keeps this document finite.
        left: { $ref: '#' },
        right: { $ref: '#' },
      },
      required: ['type', 'op', 'left', 'right'],
    },
  ],
};

export const FormulaNodeSchema: z.ZodType<FormulaNode> = z
  .unknown()
  .refine((value) => !exceedsMaxFormulaDepth(value), {
    message: `formula nests deeper than ${MAX_FORMULA_DEPTH} levels`,
  })
  .pipe(FormulaNodeShape)
  .meta(FORMULA_NODE_JSON_SCHEMA) as unknown as z.ZodType<FormulaNode>;

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
