import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const createLiceSchema = z
  .object({
    name: z.string().min(1).max(100),
    locationLabel: z.string().max(200).optional(),
    colorHex: z
      .string()
      .regex(HEX_COLOR, 'colorHex must be a valid hex color (#rrggbb)')
      .optional(),
    sortOrder: z.number().int().min(0).optional(),
    venueId: z.uuid().optional(),
  })
  .strict();
export class CreateLiceDto extends createZodDto(createLiceSchema) {}

const updateLiceSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    locationLabel: z.string().max(200).optional(),
    colorHex: z
      .string()
      .regex(HEX_COLOR, 'colorHex must be a valid hex color (#rrggbb)')
      .optional(),
    sortOrder: z.number().int().min(0).optional(),
    // org-level venue the lice lives inside, or null to detach
    venueId: z.uuid().nullish(),
  })
  .strict();
export class UpdateLiceDto extends createZodDto(updateLiceSchema) {}
