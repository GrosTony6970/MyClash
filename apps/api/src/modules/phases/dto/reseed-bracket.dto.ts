import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Re-apply Round 1 seeding to an already-generated bracket without
 * destroying the existing matches.
 */
/**
 * `by-swiss-rank` seeds from a finished Swiss phase. Unlike `by-pool-rank` it
 * needs no snake flattening — Swiss standings are ALREADY one ranked list, so
 * rank K maps straight onto seed K.
 */
export const SEEDING_STRATEGIES = [
  'snake',
  'by-rating',
  'random',
  'by-pool-rank',
  'by-swiss-rank',
] as const;
export type SeedingStrategy = (typeof SEEDING_STRATEGIES)[number];

const reseedBracketSchema = z
  .object({
    strategy: z.enum(SEEDING_STRATEGIES),
  })
  .strict();
export class ReseedBracketDto extends createZodDto(reseedBracketSchema) {}
