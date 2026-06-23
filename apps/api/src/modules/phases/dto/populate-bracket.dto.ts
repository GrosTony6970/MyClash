import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body for POST /api/v1/tournaments/:tournamentId/populate-bracket.
 *
 * Drives bracket R1 seeding from either the global cross-pool ranking
 * or a cross-pool snake fan-out of each pool's top-N qualifiers.
 */
const populateBracketSchema = z
  .object({
    seedingMode: z.enum(['overall', 'top-n-per-pool']).optional(),
    topNPerPool: z.number().int().min(1).optional(),
  })
  .strict();
export class PopulateBracketDto extends createZodDto(populateBracketSchema) {}
