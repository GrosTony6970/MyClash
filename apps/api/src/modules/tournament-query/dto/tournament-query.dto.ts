import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tournamentQuerySchema = z.object({ question: z.string() }).strict();
export class TournamentQueryDto extends createZodDto(tournamentQuerySchema) {}

/** The one list of who may use a Tournament's queries; the table's CHECK holds the same three. */
export const QUERY_ACCESS_POLICIES = [
  'organizers_only',
  'organizers_head_judges',
  'anyone_with_tournament_access',
] as const;

const tournamentQuerySettingsSchema = z
  .object({
    accessPolicy: z.enum(QUERY_ACCESS_POLICIES).optional(),
    rateLimitPerHour: z.number().optional(),
  })
  .strict();
export class TournamentQuerySettingsDto extends createZodDto(tournamentQuerySettingsSchema) {}
