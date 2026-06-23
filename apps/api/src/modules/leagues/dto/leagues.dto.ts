import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { LeagueScoringConfig, LeagueTieBreaker } from '../league.types';

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
    rankingDimensions: z.enum(['weapon', 'weapon_category']).optional(),
    // Was @IsObject: any object keyed by rank → points.
    customPointsByRank: z.custom<Record<number, number>>().optional(),
    // Was @IsArray: list of tie-breaker descriptors.
    tieBreakers: z.custom<LeagueTieBreaker[]>().optional(),
  })
  .strict();
export class CreateLeagueDto extends createZodDto(createLeagueSchema) {}

const updateLeagueSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().optional(),
    logoUrl: z.string().optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    publicVisibility: z.boolean().optional(),
    // Was @IsObject: full scoring configuration object.
    scoringConfig: z.custom<LeagueScoringConfig>().optional(),
  })
  .strict();
export class UpdateLeagueDto extends createZodDto(updateLeagueSchema) {}

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
