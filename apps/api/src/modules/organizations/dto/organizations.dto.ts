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
    // Organization brand colour as a hex string (e.g. '#c0392b').
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u, 'brandColor must be a 6-digit hex color like #c0392b')
      .nullish(),
  })
  .strict();
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}

const addMemberSchema = z
  .object({
    userId: z.uuid(),
    role: z.enum(['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only']),
  })
  .strict();
export class AddMemberDto extends createZodDto(addMemberSchema) {}
