import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Ordered tie-breaker dimensions: non-empty array of unique strings.
const tieBreakersSchema = z
  .array(z.string())
  .min(1)
  .refine((arr) => new Set(arr).size === arr.length, {
    message: 'tieBreakers must be unique',
  });

const createLeagueScoringSystemSchema = z
  .object({
    // Stable code stored on `leagues.scoring_system`. Lowercase, digits, underscores.
    code: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9_]+$/),
    name: z.string().min(2).max(120),
    // Rank → points map, e.g. { "1": 16, "2": 13, ... }.
    pointsByRank: z.record(z.string(), z.number()),
    // Ordered tie-breaker dimensions. Allowed: total_points, participation_count,
    // medal_count, double_hit_average. Defaults to the canonical FFAMHE order.
    tieBreakers: tieBreakersSchema.optional(),
    description: z.string().max(1000).nullish(),
  })
  .strict();
export class CreateLeagueScoringSystemDto extends createZodDto(createLeagueScoringSystemSchema) {}

const updateLeagueScoringSystemSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    pointsByRank: z.record(z.string(), z.number()).optional(),
    tieBreakers: tieBreakersSchema.optional(),
    description: z.string().max(1000).nullish(),
  })
  .strict();
export class UpdateLeagueScoringSystemDto extends createZodDto(updateLeagueScoringSystemSchema) {}
