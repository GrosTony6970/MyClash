import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Valid status transitions: registered → checked_in → done.
// Slice 3 of the capacity overhaul: also allow registered → withdrawn
// (operators may pull a no-show before check-in), and waitlist →
// registered (the promote path uses this transition). The 'waitlist'
// status itself is never set via PATCH /:id/status — it lands only via
// addToWaitlist or stays unchanged via the auto/manual promote paths —
// so it isn't a valid destination here.
export const REGISTRATION_STATUS_TRANSITIONS: Record<string, string[]> = {
  registered: ['checked_in', 'withdrawn'],
  checked_in: ['done', 'withdrawn'],
  done: [],
  withdrawn: [],
  disqualified: [],
  waitlist: ['registered'],
};

const createRegistrationSchema = z
  .object({
    personId: z.uuid(),
    fighterId: z.uuid().optional(),
    seed: z.number().int().min(1).optional(),
    bibNumber: z.number().int().min(1).optional(),
    hemaRatingsId: z.string().optional(),
  })
  .strict();
export class CreateRegistrationDto extends createZodDto(createRegistrationSchema) {}

const updateRegistrationStatusSchema = z
  .object({
    status: z.enum(['registered', 'checked_in', 'done', 'withdrawn', 'disqualified']),
  })
  .strict();
export class UpdateRegistrationStatusDto extends createZodDto(updateRegistrationStatusSchema) {}
