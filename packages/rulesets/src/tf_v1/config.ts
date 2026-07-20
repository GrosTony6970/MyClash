/**
 * packages/rulesets/src/tf_v1/config.ts
 *
 * TF_v1 configuration schema (Zod) and defaults.
 * Matches ARCHITECTURE.md §6.5.
 *
 * AGENTS.md hard rule #5: no eval, no Function(). The double_penalty_formula
 * is a whitelisted key, not an evaluated expression.
 */
import { z } from 'zod';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  MatchFormatConfigSchema,
  normalizeMatchFormatConfig,
} from '../match-format';
import { DEFAULT_FORFEIT_POLICY, ForfeitPolicySchema } from '../forfeits';
import { DEFAULT_DOUBLE_PENALTY_FORMULA, DoublePenaltySpecSchema } from './double-penalty';
import { DEFAULT_TARGETS, TargetsSchema, withDerivedTargets } from './targets';

/**
 * Wizard-set tournament policy switches. Lives next to (not inside)
 * `forfeitPolicy` — that engine-owned key carries per-reason scoring
 * data and is structurally unrelated. Earlier code overloaded
 * `forfeitPolicy` for both concepts and tripped a 400 on the wizard
 * PATCH; see `Step4Advanced.tsx` and migration 0062.
 */
export const TournamentPolicySchema = z.object({
  forfeitDrawsCount: z.boolean().default(false),
  forfeitFighterBefore1stMatch: z.boolean().default(false),
  disqualifyAfter: z.number().int().min(1).max(10).default(2),
});

export const DEFAULT_TOURNAMENT_POLICY = TournamentPolicySchema.parse({});

const TFv1ConfigObjectSchema = z.object({
  winBonus: z.number().int().positive().default(3),
  /**
   * Named targets — any count, any names. The grammar half of the ruleset.
   * Derived from the legacy `targetValues` pair when absent (see
   * `withDerivedTargets`), so a config written before this field existed keeps
   * parsing and lands with the same two values it always had.
   */
  targets: TargetsSchema.default(DEFAULT_TARGETS),
  /**
   * @deprecated Superseded by `targets`. Retained so the admin surfaces and
   * API paths that still read the pair keep working while they migrate; the
   * preprocess above derives `targets` FROM this, never the reverse, so
   * `targets` is the one to read.
   */
  targetValues: z
    .object({
      deepTarget: z.number().int().positive().default(2),
      shallowTarget: z.number().int().positive().default(1),
    })
    .default({ deepTarget: 2, shallowTarget: 1 }),
  matchFormat: z
    .preprocess((value) => normalizeMatchFormatConfig(value), MatchFormatConfigSchema)
    .default(DEFAULT_MATCH_FORMAT_CONFIG),
  /**
   * Either a whitelisted formula KEY (selecting one of DOUBLE_PENALTY_FORMULAS)
   * or an authored `FormulaNode` AST evaluated by our own `evaluateFormula`.
   * Never eval'd in either form — see the docblock on `double-penalty.ts`.
   *
   * Widening key → key|AST is a strict superset, so every stored 'n*(n-1)/3'
   * keeps validating. The DEFAULT stays the federal KEY rather than the
   * equivalent AST: they are bit-identical, and keeping the key leaves
   * `TFv1DefaultConfig` — and the metadata string every admin surface renders
   * off it — unchanged.
   */
  doublePenaltyFormula: DoublePenaltySpecSchema.default(DEFAULT_DOUBLE_PENALTY_FORMULA),
  forfeitPolicy: ForfeitPolicySchema.default(DEFAULT_FORFEIT_POLICY),
  tournamentPolicy: TournamentPolicySchema.default(DEFAULT_TOURNAMENT_POLICY),
});

/**
 * Wrapped in a preprocess so `targets` can be derived from the sibling
 * `targetValues` key. Only `.parse()` is ever called on this schema, so the
 * ZodObject -> ZodEffects change is invisible to callers.
 */
export const TFv1ConfigSchema = z.preprocess(withDerivedTargets, TFv1ConfigObjectSchema);

export type TFv1Config = z.infer<typeof TFv1ConfigSchema>;

export const TFv1DefaultConfig: TFv1Config = TFv1ConfigSchema.parse({});
