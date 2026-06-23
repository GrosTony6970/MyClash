import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tournamentQuerySchema = z.object({ question: z.string() }).strict();
export class TournamentQueryDto extends createZodDto(tournamentQuerySchema) {}

const tournamentQuerySettingsSchema = z
  .object({
    accessPolicy: z
      .enum([
        'organizers_only',
        'organizers_head_judges',
        'organizers_head_judges_coaches',
        'anyone_with_tournament_access',
      ])
      .optional(),
    rateLimitPerHour: z.number().optional(),
  })
  .strict();
export class TournamentQuerySettingsDto extends createZodDto(tournamentQuerySettingsSchema) {}
