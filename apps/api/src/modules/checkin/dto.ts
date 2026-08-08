import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * How the arrival was captured. Mirrors the `event_arrivals_via_allowed` CHECK
 * from 0174 — the DTO and the table hold the same rule, so a caller that
 * bypasses this schema still cannot store a third value.
 */
const arrivalViaSchema = z.enum(['search', 'qr']);

const markArrivalSchema = z
  .object({
    // Defaulted rather than required: the desk's one-tap button is the common
    // path and should not have to state the obvious. The QR lane sends 'qr'
    // explicitly, which is the reading that carries information.
    via: arrivalViaSchema.default('search'),
  })
  .strict();
export class MarkArrivalDto extends createZodDto(markArrivalSchema) {}

/**
 * A scanned pass.
 *
 * Bounded rather than open text because the value comes straight off a camera:
 * a desk pointed at a poster decodes a frame at a time, and an unbounded string
 * would carry whatever a QR on a shipping label contains into the service. The
 * real shape check is `looksLikePassToken`, which runs before any query.
 */
const scanPassSchema = z
  .object({
    token: z.string().trim().min(1).max(200),
  })
  .strict();
export class ScanPassDto extends createZodDto(scanPassSchema) {}

/**
 * Mail event passes to the roster.
 *
 * `resend` defaults to FALSE and that default is load-bearing: issuing replaces
 * the previous token, so a second mail-out after adding three fighters on the
 * Friday would otherwise kill the link every one of Thursday's recipients is
 * already holding. Sending again to everyone has to be asked for explicitly.
 */
const mailPassesSchema = z
  .object({
    resend: z.boolean().default(false),
  })
  .strict();
export class MailPassesDto extends createZodDto(mailPassesSchema) {}

const rosterQuerySchema = z
  .object({
    /**
     * The desk types three letters and expects the name.
     *
     * Optional: with no query the roster returns the first page unfiltered,
     * which is what the missing-at-risk view and a first paint want. Capped at
     * 120 because it is fed straight into a trigram match.
     */
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export class RosterQueryDto extends createZodDto(rosterQuerySchema) {}

/**
 * A gear result, mirroring the `event_gear_checks_result_allowed` CHECK.
 */
const gearResultSchema = z.enum(['pass', 'fail', 'conditional']);

/**
 * Record one equipment check.
 *
 * The refinement mirrors `event_gear_checks_conditional_needs_reason`. Both
 * exist on purpose: the CHECK is what makes the rule true of the DATA, and this
 * is what turns a violation into a 400 the volunteer can read instead of a 500
 * from Postgres. A conditional carrying no text is indistinguishable from a
 * pass by the time it reaches the piste, which is the whole reason the state
 * exists.
 *
 * A reason on `fail` stays optional — "no gorget" is often self-evident and the
 * fighter is standing right there.
 */
const recordGearCheckSchema = z
  .object({
    result: gearResultSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.result !== 'conditional' || Boolean(value.reason?.trim()), {
    message: 'A conditional pass needs a reason',
    path: ['reason'],
  });
export class RecordGearCheckDto extends createZodDto(recordGearCheckSchema) {}
