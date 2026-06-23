import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Re-apply Round 1 seeding to an already-generated bracket without
 * destroying the existing matches.
 */
const reseedBracketSchema = z
  .object({
    strategy: z.enum(['snake', 'by-rating', 'random', 'by-pool-rank']),
  })
  .strict();
export class ReseedBracketDto extends createZodDto(reseedBracketSchema) {}
