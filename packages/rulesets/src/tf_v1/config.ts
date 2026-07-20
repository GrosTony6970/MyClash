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
import { DEFAULT_DOUBLE_PENALTY_FORMULA, DOUBLE_PENALTY_FORMULA_KEYS } from './double-penalty';

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

export const TFv1ConfigSchema = z.object({
  winBonus: z.number().int().positive().default(3),
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
   * Whitelisted formula KEY — never eval'd; it selects one of
   * DOUBLE_PENALTY_FORMULAS. Widening literal → enum is a strict superset, so
   * every stored 'n*(n-1)/3' keeps validating.
   */
  doublePenaltyFormula: z.enum(DOUBLE_PENALTY_FORMULA_KEYS).default(DEFAULT_DOUBLE_PENALTY_FORMULA),
  forfeitPolicy: ForfeitPolicySchema.default(DEFAULT_FORFEIT_POLICY),
  tournamentPolicy: TournamentPolicySchema.default(DEFAULT_TOURNAMENT_POLICY),
});

export type TFv1Config = z.infer<typeof TFv1ConfigSchema>;

export const TFv1DefaultConfig: TFv1Config = TFv1ConfigSchema.parse({});
