import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const savePlatformAISettingsSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'mistral', 'google']),
    apiKey: z.string().min(10),
    // Selected model id (from the model registry). Nullable-optional so the FE
    // can send `null` to clear back to the provider default. Validity against
    // the provider is enforced in the service via `isValidModelForProvider`.
    model: z.string().nullable().optional(),
  })
  .strict();
export class SavePlatformAISettingsDto extends createZodDto(savePlatformAISettingsSchema) {}
