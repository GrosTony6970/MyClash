import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AuthoredTargetsSchema,
  DoublePenaltySpecSchema,
  MAX_AUTHORED_TARGET_VALUE,
} from '@myclash/rulesets';

/**
 * The grammar half of a ruleset: what an exchange can be and what it is worth.
 * Authorable on EVERY ruleset, which is the point — `tf_config.targetValues`
 * was two anonymous slots read only for is_system rows, so an org-authored
 * ruleset had nowhere to declare this at all.
 *
 * `AuthoredTargetsSchema` is the strict write-side bound (value 1..10, the cap
 * createExchangeSchema puts on firstStrikeValue). The engine's read-side
 * schema stays liberal so older configs keep parsing; see targets.ts.
 */
const rulesetGrammarShape = {
  targets: AuthoredTargetsSchema.optional(),
  hasAfterblow: z.boolean().optional(),
  // Seeds a new tournament's afterblow mode. Never authoritative at scoring
  // time — the tournament's scoring_config_json is.
  afterblowMode: z.enum(['full', 'deductive']).optional(),
  // How the retaliation is worth points, which decides the button grid:
  // `fixed` gives N buttons, `weighted` the full attacker x defender product.
  afterblowValuation: z.enum(['fixed', 'weighted']).optional(),
  // Bounded by createExchangeSchema's cap on a button's value.
  afterblowFixedValue: z.number().int().min(1).max(MAX_AUTHORED_TARGET_VALUE).optional(),
};

const tiebreakerSchema = z.object({
  variable: z.string(),
  direction: z.enum(['asc', 'desc']),
});

/**
 * Loose validate/preview payload. The endpoint REPORTS problems (ok/errors/
 * preview) rather than 400ing, so the body is permissive — the service does the
 * real checking. Only `targets` is shape-checked (it drives the display).
 */
const validateRulesetSchema = z
  .object({
    scoreFormula: z.unknown().optional(),
    constants: z.unknown().optional(),
    tiebreakers: z.unknown().optional(),
    doublePenaltyFormula: z.unknown().nullish(),
    targets: z.array(z.object({ name: z.string(), value: z.number() })).nullish(),
  })
  .passthrough();
export class ValidateRulesetDto extends createZodDto(validateRulesetSchema) {}

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
    // A named double-hit penalty: a whitelist KEY or an authored FormulaNode
    // AST over `doubleHits`. The score formula references its result via the
    // `doublePenalty` variable. Never eval'd — validated + evaluated by us.
    doublePenaltyFormula: DoublePenaltySpecSchema.nullish(),
    ...rulesetGrammarShape,
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
    doublePenaltyFormula: DoublePenaltySpecSchema.nullish(),
    // Super-admin overrides for TF v1's TFv1ConfigSchema-shaped defaults
    // (winBonus, targetValues, matchFormat, doublePenaltyFormula, forfeitPolicy).
    // Merged over the static TFv1DefaultConfig by resolveRulesetConfigDefaults.
    tfConfig: z.record(z.string(), z.unknown()).optional(),
    ...rulesetGrammarShape,
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
