import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createVenueSchema = z
  .object({
    name: z.string().min(1).max(200),
    // `.nullable()` so the FE can send `address: null` to clear it (an empty
    // form field) — `.optional()` alone rejects null and 400s the whole request.
    address: z.string().max(500).nullable().optional(),
    hostsTournament: z.boolean().optional(),
    hostsWorkshop: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export class CreateVenueDto extends createZodDto(createVenueSchema) {}

const updateVenueSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(500).nullable().optional(),
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

const setEventVenuesSchema = z
  .object({
    venueIds: z.array(z.uuid()).max(100),
  })
  .strict();
export class SetEventVenuesDto extends createZodDto(setEventVenuesSchema) {}

// Per-phase-type venue assignment for a tournament. An omitted key leaves that
// phase's venue unchanged; an explicit `null` clears it (`.nullable()` so the FE
// can send null to clear — see the zod null-to-clear gotcha in memory).
const setTournamentPhaseVenuesSchema = z
  .object({
    pool: z.uuid().nullable().optional(),
    bracket: z.uuid().nullable().optional(),
  })
  .strict();
export class SetTournamentPhaseVenuesDto extends createZodDto(setTournamentPhaseVenuesSchema) {}
