import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Re-apply Round 1 seeding to an already-generated bracket without
 * destroying the existing matches.
 */
export const SEEDING_STRATEGIES = ['snake', 'by-rating', 'random', 'by-pool-rank'] as const;
export type SeedingStrategy = (typeof SEEDING_STRATEGIES)[number];

const reseedBracketSchema = z
  .object({
    strategy: z.enum(SEEDING_STRATEGIES),
  })
  .strict();
export class ReseedBracketDto extends createZodDto(reseedBracketSchema) {}
