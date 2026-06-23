import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const savePlatformAISettingsSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'mistral']),
    apiKey: z.string().min(10),
  })
  .strict();
export class SavePlatformAISettingsDto extends createZodDto(savePlatformAISettingsSchema) {}
