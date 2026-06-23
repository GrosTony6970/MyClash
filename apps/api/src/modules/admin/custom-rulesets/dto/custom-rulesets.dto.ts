import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tiebreakerSchema = z.object({
  variable: z.string(),
  direction: z.enum(['asc', 'desc']),
});

const createCustomRulesetSchema = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().max(1000).optional(),
    version: z.string().max(50).optional(),
    // Score formula AST (FormulaNode tree) — arbitrary JSON object.
    scoreFormula: z.record(z.string(), z.unknown()),
    // Per-ruleset numeric constants: pointsPerVictory, pointsPerTie, pointsPerLoss, doublePenalty.
    constants: z.record(z.string(), z.number()),
    // Ordered list of tiebreakers ({ variable, direction }).
    tiebreakers: z.array(tiebreakerSchema),
    // MatchFormatConfig used as the default for tournaments created with this ruleset.
    matchFormatDefaults: z.record(z.string(), z.unknown()).optional(),
    // Free-string expression in terms of `n` (double-hit count). Validated server-side.
    doublePenaltyFormula: z.string().max(200).optional(),
  })
  .strict();
export class CreateCustomRulesetDto extends createZodDto(createCustomRulesetSchema) {}

const updateCustomRulesetSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(1000).optional(),
    version: z.string().max(50).optional(),
    scoreFormula: z.record(z.string(), z.unknown()).optional(),
    constants: z.record(z.string(), z.number()).optional(),
    tiebreakers: z.array(tiebreakerSchema).optional(),
    matchFormatDefaults: z.record(z.string(), z.unknown()).optional(),
    doublePenaltyFormula: z.string().max(200).optional(),
    // Super-admin overrides for TF v1's TFv1ConfigSchema-shaped defaults
    // (winBonus, targetValues, matchFormat, doublePenaltyFormula, forfeitPolicy).
    // Merged over the static TFv1DefaultConfig by resolveRulesetConfigDefaults.
    tfConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export class UpdateCustomRulesetDto extends createZodDto(updateCustomRulesetSchema) {}

const customRulesetStatusSchema = z
  .object({
    status: z.enum(['draft', 'published', 'archived']),
  })
  .strict();
export class CustomRulesetStatusDto extends createZodDto(customRulesetStatusSchema) {}

const setDefaultSchema = z.object({ isDefault: z.boolean() }).strict();
export class SetDefaultDto extends createZodDto(setDefaultSchema) {}

const publishRulesetSchema = z
  .object({
    // Optional explicit version string for the new draft after publish.
    // When omitted the server auto-bumps the patch component (1.0.0 -> 1.0.1).
    nextVersion: z.string().max(50).optional(),
  })
  .strict();
export class PublishRulesetDto extends createZodDto(publishRulesetSchema) {}

const rejectSubmissionSchema = z
  .object({
    // Reason shown to the organizer so they know what to fix before resubmitting.
    reason: z.string().min(2).max(1000),
  })
  .strict();
export class RejectSubmissionDto extends createZodDto(rejectSubmissionSchema) {}
