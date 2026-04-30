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

export const TFv1ConfigSchema = z.object({
  winBonus: z.number().int().positive().default(3),
  afterblowWindowMs: z.number().int().positive().default(1000),
  targetValues: z
    .object({
      deepTarget: z.number().int().positive().default(2),
      shallowTarget: z.number().int().positive().default(1),
    })
    .default({ deepTarget: 2, shallowTarget: 1 }),
  matchFormat: z
    .object({
      firstToPoints: z.number().int().positive().nullable().default(null),
      timeLimitSeconds: z.number().int().positive().nullable().default(180),
      maxDoubles: z.number().int().positive().nullable().default(null),
    })
    .default({ firstToPoints: null, timeLimitSeconds: 180, maxDoubles: null }),
  /** Whitelisted formula key — never eval'd */
  doublePenaltyFormula: z.literal('n*(n-1)/3').default('n*(n-1)/3'),
});

export type TFv1Config = z.infer<typeof TFv1ConfigSchema>;

export const TFv1DefaultConfig: TFv1Config = TFv1ConfigSchema.parse({});
