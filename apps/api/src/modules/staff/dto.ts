import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createStaffAccountSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    username: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/),
    pin: z
      .string()
      .min(4)
      .max(12)
      .regex(/^[0-9]+$/),
  })
  .strict();
export class CreateStaffAccountDto extends createZodDto(createStaffAccountSchema) {}

const updateStaffAccountSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    username: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict();
export class UpdateStaffAccountDto extends createZodDto(updateStaffAccountSchema) {}

const resetStaffPinSchema = z
  .object({
    pin: z
      .string()
      .min(4)
      .max(12)
      .regex(/^[0-9]+$/),
  })
  .strict();
export class ResetStaffPinDto extends createZodDto(resetStaffPinSchema) {}

const setStaffLicesSchema = z
  .object({
    liceIds: z
      .array(z.uuid())
      .max(64)
      .refine((a) => new Set(a).size === a.length, 'must be unique'),
  })
  .strict();
export class SetStaffLicesDto extends createZodDto(setStaffLicesSchema) {}

const setLiceScorerSchema = z
  .object({
    /**
     * The account to put on this piste, or null to leave it unmanned.
     *
     * Nullable rather than optional: "this piste has no scorer" is a state the
     * organizer must be able to SET (a piste going dark over lunch), and it is
     * the only way to undo a mis-assignment without inventing a DELETE verb.
     * An omitted key is a client bug and should fail, so the key stays required.
     */
    staffAccountId: z.uuid().nullable(),
  })
  .strict();
export class SetLiceScorerDto extends createZodDto(setLiceScorerSchema) {}

const staffLoginSchema = z
  .object({
    eventSlugOrCode: z.string().min(1).max(160),
    username: z.string().min(3).max(64),
    pin: z.string().min(4).max(12),
  })
  .strict();
export class StaffLoginDto extends createZodDto(staffLoginSchema) {}

const staffHeartbeatSchema = z
  .object({
    outboxDepth: z.number().int().min(0),
    oldestPendingAgeSec: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
    // The tablet's own Date.now() at send time. The server subtracts it from
    // its receipt time to get clock skew — see 0172_staff_clock_skew.sql for
    // why a wrong tablet clock is silent rather than loud.
    //
    // Optional so a tablet running an older bundle mid-event still heartbeats
    // (they are best-effort telemetry and must never fail); unbounded because
    // the whole point is to catch an absurd value, and a `.max()` here would
    // reject exactly the reading worth having.
    clientNowMs: z.number().int().optional(),
  })
  .strict();
export class StaffHeartbeatDto extends createZodDto(staffHeartbeatSchema) {}
