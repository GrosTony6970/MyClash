import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Which population of accounts to list.
 *
 * These are PREDICATES, not a partition. An account that holds a platform role
 * AND an organisation membership satisfies both `platform` and `organizer` and
 * appears under both — which is the normal shape for a HEMA organiser who also
 * works the platform. Per-scope totals therefore do not sum to the number of
 * accounts, and the console says so rather than pretending otherwise.
 */
export const USER_LIST_SCOPES = ['platform', 'organizer', 'user'] as const;
export type UserListScope = (typeof USER_LIST_SCOPES)[number];

const listPlatformUsersSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    // Clamped: the response hydrates org memberships per row, so an unbounded
    // perPage turns one request into an unbounded fan-out.
    perPage: z.coerce.number().int().min(1).max(100).default(50),
    q: z.string().trim().max(100).optional(),
    scope: z.enum(USER_LIST_SCOPES).default('platform'),
  })
  .strict();
export class ListPlatformUsersQueryDto extends createZodDto(listPlatformUsersSchema) {}

export const ORG_ROLES = [
  'owner',
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

const createPlatformUserSchema = z
  .object({
    email: z.email(),
    displayName: z.string().min(1).max(120).optional(),
    makeSuperAdmin: z.boolean().optional(),
  })
  .strict();
export class CreatePlatformUserDto extends createZodDto(createPlatformUserSchema) {}

const updatePlatformUserSchema = z
  .object({
    email: z.email().optional(),
    displayName: z.string().max(120).optional(),
  })
  .strict();
export class UpdatePlatformUserDto extends createZodDto(updatePlatformUserSchema) {}

const addOrgMembershipSchema = z
  .object({
    organizationId: z.uuid(),
    role: z.enum(ORG_ROLES),
  })
  .strict();
export class AddOrgMembershipDto extends createZodDto(addOrgMembershipSchema) {}

const updateOrgMembershipRoleSchema = z
  .object({
    role: z.enum(ORG_ROLES),
  })
  .strict();
export class UpdateOrgMembershipRoleDto extends createZodDto(updateOrgMembershipRoleSchema) {}
