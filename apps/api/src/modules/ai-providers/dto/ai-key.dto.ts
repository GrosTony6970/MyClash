import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Shared DTOs for the multi-key AI settings surfaces (platform / organization /
 * fighter). A "key" bundles a provider, an optional model, the secret, and an
 * optional per-key monthly budget. Model validity against the provider is
 * enforced in the service (`isValidModelForProvider`).
 */
const createAiKeySchema = z
  .object({
    label: z.string().min(1).max(80),
    provider: z.enum(['anthropic', 'openai', 'mistral', 'google']),
    model: z.string().nullable().optional(),
    apiKey: z.string().min(10),
    // Per-key monthly budget in EUR; null/omitted = unlimited.
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
    // Make this the active key for the scope on create.
    isActive: z.boolean().optional(),
  })
  .strict();
export class CreateAiKeyDto extends createZodDto(createAiKeySchema) {}

const updateAiKeySchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    provider: z.enum(['anthropic', 'openai', 'mistral', 'google']).optional(),
    model: z.string().nullable().optional(),
    // Optional — omit/blank to keep the current stored key; a new value re-encrypts.
    apiKey: z.string().min(10).optional(),
    monthlyBudgetEur: z.number().nonnegative().nullable().optional(),
  })
  .strict();
export class UpdateAiKeyDto extends createZodDto(updateAiKeySchema) {}
