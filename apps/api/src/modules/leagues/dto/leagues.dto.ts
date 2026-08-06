import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// NOTE: these used to be `z.custom<LeagueScoringConfig>()` etc. (straight
// @IsObject/@IsArray migrations). z.custom cannot be represented in JSON
// Schema, so `cleanupOpenApiDoc()` threw at bootstrap and broke OpenAPI
// emission (dev Swagger + `pnpm gen:api-client`). Modeled for real instead —
// same accepted payloads, now serializable.

const leagueTieBreakerSchema = z.enum([
  'total_points',
  'participation_count',
  'medal_count',
  'double_hit_average',
]);

/** JSON object keys arrive as strings — "rank" keys must be digit strings. */
const customPointsByRankSchema = z.record(z.string().regex(/^\d+$/u), z.number());

const leagueScoringConfigSchema = z.object({
  // Open string: 'ffamhe_tf_2026' | 'custom' | any registry code (mig 0068).
  scoringSystem: z.string(),
  rankingDimensions: z.enum(['weapon', 'weapon_category', 'group']),
  customPointsByRank: customPointsByRankSchema.optional(),
  tieBreakers: z.array(leagueTieBreakerSchema),
});

const createLeagueSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
    seasonYear: z.number().int().min(2000).max(2100),
    description: z.string().optional(),
    logoUrl: z.string().optional(),
    ownerOrganizationId: z.uuid().optional(),
    scoringSystem: z.enum(['ffamhe_tf_2026', 'custom']).optional(),
    rankingDimensions: z.enum(['weapon', 'weapon_category', 'group']).optional(),
    // Object keyed by rank → points (JSON keys are digit strings).
    customPointsByRank: customPointsByRankSchema.optional(),
    tieBreakers: z.array(leagueTieBreakerSchema).optional(),
  })
  .strict();
export class CreateLeagueDto extends createZodDto(createLeagueSchema) {}

const updateLeagueSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().nullish(),
    logoUrl: z.string().nullish(),
    // No publicVisibility: it is derived from `status` in LeaguesService.update()
    // (published <=> public). .strict() rejects callers that try to set it apart.
    status: z.enum(['draft', 'published', 'archived']).optional(),
    // Full scoring configuration object (unknown extra keys are stripped).
    scoringConfig: leagueScoringConfigSchema.optional(),
  })
  .strict();
export class UpdateLeagueDto extends createZodDto(updateLeagueSchema) {}

const cloneLeagueSchema = z
  .object({
    // The new season year for the cloned league. Required — cloning is a
    // roll-into-new-season action, so a distinct year is the whole point.
    seasonYear: z.number().int().min(2000).max(2100),
    // Optional override for the clone's name; defaults to the source name.
    name: z.string().min(2).max(200).optional(),
  })
  .strict();
export class CloneLeagueDto extends createZodDto(cloneLeagueSchema) {}

const addLeagueOrganizationRoleSchema = z
  .object({
    organizationId: z.uuid(),
    role: z.enum(['member', 'admin', 'owner']),
  })
  .strict();
export class AddLeagueOrganizationRoleDto extends createZodDto(addLeagueOrganizationRoleSchema) {}

const addLeagueUserRoleSchema = z
  .object({
    userId: z.uuid(),
    role: z.enum(['admin', 'owner']),
  })
  .strict();
export class AddLeagueUserRoleDto extends createZodDto(addLeagueUserRoleSchema) {}

const reviewLeagueTournamentLinkSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'removed']).optional(),
    // Assign this link to a league group, or null to clear.
    groupId: z.uuid().nullish(),
  })
  .strict();
export class ReviewLeagueTournamentLinkDto extends createZodDto(reviewLeagueTournamentLinkSchema) {}

const leagueGroupSchema = z
  .object({
    name: z.string().min(1).max(120),
    sortOrder: z.number().optional(),
  })
  .strict();
export class LeagueGroupDto extends createZodDto(leagueGroupSchema) {}

const updateLeagueGroupSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    sortOrder: z.number().optional(),
  })
  .strict();
export class UpdateLeagueGroupDto extends createZodDto(updateLeagueGroupSchema) {}

const linkTournamentSchema = z
  .object({
    groupId: z.uuid().nullish(),
  })
  .strict();
export class LinkTournamentDto extends createZodDto(linkTournamentSchema) {}

const leagueStandingsQuerySchema = z
  .object({
    group: z.string().optional(),
  })
  .strict();
export class LeagueStandingsQueryDto extends createZodDto(leagueStandingsQuerySchema) {}
