import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const modelSyncSchema = z
  .object({
    // Optional ad-hoc probe. Omit both to use the configured platform provider
    // and its stored key. When `apiKey` is set, `provider` is required.
    provider: z.enum(['anthropic', 'openai', 'mistral', 'google']).optional(),
    apiKey: z.string().min(10).optional(),
  })
  .strict();
export class ModelSyncDto extends createZodDto(modelSyncSchema) {}
