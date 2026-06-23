import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SLUG = /^[a-z0-9-]+$/;
const SLUG_MSG = 'Slug must contain only lowercase letters, digits, and hyphens';

const listOrgsQuerySchema = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    q: z.string().optional(),
    sortBy: z.enum(['name', 'created_at', 'last_activity']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    // Query string 'true' (or boolean true) → exclude platform-owned orgs;
    // anything else (incl. omitted) → no exclusion. Mirrors the prior @Transform.
    excludePlatform: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  })
  .strict();
export class ListOrgsQueryDto extends createZodDto(listOrgsQuerySchema) {}

const createOrganizationSchema = z
  .object({
    name: z.string().min(2).max(100),
    slug: z.string().min(3).max(50).regex(SLUG, SLUG_MSG),
    ownerEmail: z.email().optional(),
    ownerDisplayName: z.string().min(2).max(100).optional(),
    ownerUserId: z.uuid().optional(),
  })
  .strict();
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

const updateOrganizationSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    slug: z.string().min(3).max(50).regex(SLUG, SLUG_MSG).optional(),
  })
  .strict();
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}

const reassignOwnerSchema = z
  .object({
    ownerUserId: z.uuid().optional(),
    ownerEmail: z.email().optional(),
    ownerDisplayName: z.string().min(2).max(100).optional(),
    /** @deprecated Use `ownerUserId` instead. Kept for backwards compatibility. */
    newOwnerUserId: z.uuid().optional(),
  })
  .strict();
export class ReassignOwnerDto extends createZodDto(reassignOwnerSchema) {}

const promoteSuperAdminSchema = z.object({ userId: z.uuid() }).strict();
export class PromoteSuperAdminDto extends createZodDto(promoteSuperAdminSchema) {}
