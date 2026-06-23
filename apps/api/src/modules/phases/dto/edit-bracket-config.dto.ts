import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Post-generation bracket configuration edit.
 * Currently only grandFinalReset (double-elim) is editable.
 */
const editBracketConfigSchema = z
  .object({
    grandFinalReset: z.boolean().optional(),
  })
  .strict();
export class EditBracketConfigDto extends createZodDto(editBracketConfigSchema) {}
