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
  /** Whitelisted formula key — never eval'd */
  doublePenaltyFormula: z.literal('n*(n-1)/3').default('n*(n-1)/3'),
  forfeitPolicy: ForfeitPolicySchema.default(DEFAULT_FORFEIT_POLICY),
});

export type TFv1Config = z.infer<typeof TFv1ConfigSchema>;

export const TFv1DefaultConfig: TFv1Config = TFv1ConfigSchema.parse({});
