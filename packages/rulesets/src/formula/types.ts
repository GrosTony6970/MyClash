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

// ── Zod schemas (used by DTO validation and configSchema on the Ruleset) ──

const VariableSchema = z.enum(FORMULA_VARIABLE_KEYS);
const OperatorSchema = z.enum(['+', '-', '*', '/']);

export const MAX_FORMULA_DEPTH = 32;

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
 * Depth bound, enforced explicitly now that the shape no longer encodes it.
 *
 * Iterative on purpose: this runs on UNVALIDATED input, so a hostile 100k-deep
 * payload must not overflow the stack inside the guard meant to reject it.
 */
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

export function isVariableKey(value: string): value is VariableKey {
  return (FORMULA_VARIABLE_KEYS as readonly string[]).includes(value);
}
