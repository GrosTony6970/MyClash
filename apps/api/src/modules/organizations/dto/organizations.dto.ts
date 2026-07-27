import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createOrganizationSchema = z
  .object({
    name: z.string().min(2).max(100),
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens'),
    contactEmail: z.email().optional(),
  })
  .strict();
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

const updateOrganizationSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    contactEmail: z.email().optional(),
    // Public URL of the organization logo (set by the upload endpoint).
    logoUrl: z.string().max(500).nullish(),
    // Organization brand colour as a hex string (e.g. '#b91c1c').
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u, 'brandColor must be a 6-digit hex color like #b91c1c')
      .nullish(),
  })
  .strict();
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}

/**
 * Query for the anonymous organiser directory (GET /organizations/public).
 *
 * Query values arrive as strings, so the numbers are coerced before their
 * bounds are checked — same reason as eventQuerySchema.
 */
const publicOrganizationQuerySchema = z
  .object({
    // Free text over the organisation name only. There is nothing else on the
    // row worth matching: city/country live on events, not organisations.
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().min(1).max(50).optional(),
    offset: z.coerce.number().min(0).optional(),
  })
  .strict();
export class PublicOrganizationQueryDto extends createZodDto(publicOrganizationQuerySchema) {}

const addMemberSchema = z
  .object({
    // Exactly one of userId / email (the service validates the pairing):
    // owners add teammates by email — they never see raw account ids.
    userId: z.uuid().optional(),
    email: z.email().optional(),
    role: z.enum(['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only']),
  })
  .strict();
export class AddMemberDto extends createZodDto(addMemberSchema) {}
