import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createWeaponSchema = z
  .object({
    // Display name; the slug is derived server-side via slugify().
    name: z.string().min(1).max(100),
  })
  .strict();
export class CreateWeaponDto extends createZodDto(createWeaponSchema) {}

const updateWeaponSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    // Deactivate (soft-remove) drops the weapon from pickers without deleting
    // it or its fighter associations.
    active: z.boolean().optional(),
  })
  .strict();
export class UpdateWeaponDto extends createZodDto(updateWeaponSchema) {}
