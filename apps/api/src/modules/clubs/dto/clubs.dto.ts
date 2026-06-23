import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createClubSchema = z
  .object({
    name: z.string().min(2).max(100),
    abbreviation: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    countryCode: z.string().max(100).optional(),
    website: z.string().max(255).optional(),
    logoUrl: z.string().optional(),
  })
  .strict();
export class CreateClubDto extends createZodDto(createClubSchema) {}

const updateClubSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    abbreviation: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    countryCode: z.string().max(100).optional(),
    website: z.string().max(255).optional(),
    logoUrl: z.string().optional(),
  })
  .strict();
export class UpdateClubDto extends createZodDto(updateClubSchema) {}

const clubQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    // Loose query flags: the service coerces these itself (booleanQueryValue /
    // truthy check), so pass the raw query value (string or boolean) through
    // unchanged to preserve behaviour.
    searchAbv: z.union([z.boolean(), z.string()]).optional(),
    includeArchived: z.union([z.boolean(), z.string()]).optional(),
  })
  .strict();
export class ClubQueryDto extends createZodDto(clubQuerySchema) {}

const clubReviewRequestQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'linked', 'rejected', 'all']).optional(),
  })
  .strict();
export class ClubReviewRequestQueryDto extends createZodDto(clubReviewRequestQuerySchema) {}

const linkClubReviewRequestSchema = z
  .object({
    existingClubId: z.uuid(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export class LinkClubReviewRequestDto extends createZodDto(linkClubReviewRequestSchema) {}

const rejectClubReviewRequestSchema = z.object({ notes: z.string().max(1000).optional() }).strict();
export class RejectClubReviewRequestDto extends createZodDto(rejectClubReviewRequestSchema) {}

/**
 * Body for the bulk admin endpoints (bulk-verify | bulk-unverify | bulk-archive
 * | bulk-delete). Max 200 ids per call to keep the sequential fan-out bounded.
 */
const bulkClubIdsSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict();
export class BulkClubIdsDto extends createZodDto(bulkClubIdsSchema) {}

/**
 * Body for POST /clubs/bulk-update. At least one of city/countryCode/unverified
 * must be present — the service rejects with 'No fields to update' otherwise.
 */
const bulkClubUpdateSchema = bulkClubIdsSchema.extend({
  city: z.string().max(100).optional(),
  countryCode: z.string().max(100).optional(),
  unverified: z.boolean().optional(),
});
export class BulkClubUpdateDto extends createZodDto(bulkClubUpdateSchema) {}
