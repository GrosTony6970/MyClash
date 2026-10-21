import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// The organiser's hand (`registrations.entry_status`, migration 0240): what PATCH /:id/status
// may change it to. The status itself is the settle's (a forfeit, a card or a review can hold
// the Fighter out whatever the hand says), so the table is keyed on the hand. A withdrawal by
// hand can be undone (ruling 110). A waitlisted entry is seated by the promote, which checks the
// capacity and closes the queue behind it, never here. There is no 'done' (0078).
export const REGISTRATION_STATUS_TRANSITIONS: Record<string, string[]> = {
  registered: ['checked_in', 'withdrawn'],
  checked_in: ['withdrawn'],
  withdrawn: ['registered'],
  waitlist: [],
};

const createRegistrationSchema = z
  .object({
    personId: z.uuid(),
    seed: z.number().int().min(1).optional(),
    bibNumber: z.number().int().min(1).optional(),
    // Null = no id given: the roster page sends it for an empty field. The id
    // only serves a person with no global profile yet: it helps match them to
    // one, or goes onto the profile minted for them. It is never written onto
    // an existing profile (registrations.service.ts,
    // resolveFighterForRegistration; operator ruling 35).
    hemaRatingsId: z.string().nullable().optional(),
  })
  .strict();
export class CreateRegistrationDto extends createZodDto(createRegistrationSchema) {}

const updateRegistrationStatusSchema = z
  .object({
    status: z.enum(['registered', 'checked_in', 'done', 'withdrawn', 'disqualified']),
  })
  .strict();
export class UpdateRegistrationStatusDto extends createZodDto(updateRegistrationStatusSchema) {}
