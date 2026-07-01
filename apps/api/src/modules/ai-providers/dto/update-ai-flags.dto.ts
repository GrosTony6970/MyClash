import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const updateAIFlagsSchema = z
  .object({
    // Per-org AI availability overrides. Omit a field to leave it unchanged.
    aiFeaturesDisabled: z.boolean().optional(),
    organizerChatDisabled: z.boolean().optional(),
  })
  .strict();
export class UpdateAIFlagsDto extends createZodDto(updateAIFlagsSchema) {}
