import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const saveAISettingsSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'mistral']),
    apiKey: z.string().min(10),
  })
  .strict();
export class SaveAISettingsDto extends createZodDto(saveAISettingsSchema) {}
