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
