import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createVenueSchema = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().max(500).optional(),
    hostsTournament: z.boolean().optional(),
    hostsWorkshop: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class CreateVenueDto extends createZodDto(createVenueSchema) {}

const updateVenueSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(500).optional(),
    hostsTournament: z.boolean().optional(),
    hostsWorkshop: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class UpdateVenueDto extends createZodDto(updateVenueSchema) {}

const createVenueAreaSchema = z
  .object({
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class CreateVenueAreaDto extends createZodDto(createVenueAreaSchema) {}

const updateVenueAreaSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class UpdateVenueAreaDto extends createZodDto(updateVenueAreaSchema) {}

const createVenueLiceSchema = z
  .object({
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class CreateVenueLiceDto extends createZodDto(createVenueLiceSchema) {}
