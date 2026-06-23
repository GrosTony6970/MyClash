import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
