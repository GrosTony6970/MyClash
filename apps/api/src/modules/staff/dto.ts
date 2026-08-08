import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { STAFF_ROLES } from '@myclash/types';

/**
 * Which job the account does. Mirrors the `event_staff_accounts_role_allowed`
 * CHECK from 0173 — the DTO and the table hold the same rule, so a caller that
 * bypasses this schema still cannot store a fourth value.
 */
const staffRoleSchema = z.enum(STAFF_ROLES);

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
    // Optional so the column's own DEFAULT is the single source of the
    // historical meaning of a role-less staff account (scoring). The admin
    // create form always sends one — it is derived from the active tab, so
    // there is no dropdown to leave unset.
    role: staffRoleSchema.optional(),
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
    // Re-roling an existing account rather than deleting and recreating it:
    // the organiser who put a volunteer on the wrong tab keeps their PIN and
    // their sign-in link. Takes effect on the volunteer's next request, since
    // nothing caches the role.
    role: staffRoleSchema.optional(),
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
    /**
     * Preferred over the slug when the caller knows it — which the login
     * page's event picker always does.
     *
     * `events.slug` is UNIQUE **(organization_id, slug)**, not globally unique
     * (`events_organization_id_slug_key`). Two organisations may both run an
     * `open-2026`, and `findEventBySlug` resolves with `.maybeSingle()`, which
     * does not survive a multi-row match — so a slug collision makes staff
     * login fail with "Event not found" for BOTH events, with nothing on the
     * screen to suggest why. Picking from a list makes the id available, so the
     * ambiguity simply never arises on that path.
     *
     * Optional, and `eventSlugOrCode` stays required: the `?event=<slug>` deep
     * link an organiser prints on a QR code carries no id, and a `.refine()`
     * making exactly one of them required would turn this schema into a
     * ZodEffects, which the offline OpenAPI emit cannot render.
     */
    eventId: z.uuid().optional(),
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
