import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createPlanSchema = z
  .object({
    name: z.string().max(100),
    description: z.string().max(500).optional(),
    publicVisibility: z.boolean().optional(),
  })
  .strict();
export class CreatePlanDto extends createZodDto(createPlanSchema) {}

const updatePlanSchema = z
  .object({
    name: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    publicVisibility: z.boolean().optional(),
  })
  .strict();
export class UpdatePlanDto extends createZodDto(updatePlanSchema) {}

// Nested element schema for UpsertRoleRatesDto.rates. Not whitelisted
// (no .strict()) to match prior @ValidateNested element behavior.
const roleRateEntrySchema = z.object({
  refereeRole: z.enum(['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table']),
  compensationPhase: z.enum(['pool', 'bracket', 'finals']),
  tokensPerMatch: z.number().min(0),
});
// Exported as a DTO so it remains usable as a type (consumed by the service).
export class RoleRateEntryDto extends createZodDto(roleRateEntrySchema) {}

const upsertRoleRatesSchema = z
  .object({
    rates: z.array(roleRateEntrySchema),
  })
  .strict();
export class UpsertRoleRatesDto extends createZodDto(upsertRoleRatesSchema) {}

// Nested element schema for UpsertTiersDto.tiers. Not whitelisted (no .strict()).
const tierEntrySchema = z.object({
  minTokens: z.number().min(0),
  maxTokens: z.number().min(0).nullish(),
  amount: z.number().min(0),
});
// Exported as a DTO so it remains usable as a type (consumed by the service).
export class TierEntryDto extends createZodDto(tierEntrySchema) {}

const upsertTiersSchema = z
  .object({
    tiers: z.array(tierEntrySchema),
  })
  .strict();
export class UpsertTiersDto extends createZodDto(upsertTiersSchema) {}

const upsertEventSettingsSchema = z
  .object({
    planId: z.uuid(),
    maxCompensationAmount: z.number().min(0).nullish(),
  })
  .strict();
export class UpsertEventSettingsDto extends createZodDto(upsertEventSettingsSchema) {}

const togglePaidSchema = z
  .object({
    paid: z.boolean(),
  })
  .strict();
export class TogglePaidDto extends createZodDto(togglePaidSchema) {}
