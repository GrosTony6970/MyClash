import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The most bouts one board save names: a whole day being cleared, with room to
 * spare. Every read of the batch goes out in pieces of `IN_LIST_MAX` ids, so this
 * is not a URL limit — it bounds how many rows one request writes.
 */
export const PLACEMENTS_MAX = 2000;

/**
 * Where one bout goes: a piste and a start, or `null` for both to take it off
 * the board. Half of one is allowed, as on the single-Match PATCH: a bout can
 * sit on a piste with no time yet, and undo puts such a bout back exactly where
 * it was. No length: the run window is the one door that writes a bout's length
 * (ADR-018).
 *
 * Both keys are required — `null` is how a row says "none". The time must carry
 * an offset: the board sends the `+00:00` form PostgREST wrote, and a time
 * without one would be read in the server's own zone.
 */
const placementSchema = z
  .object({
    matchId: z.uuid(),
    liceId: z.uuid().nullable(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

/**
 * One gesture on the schedule board, saved as one batch: the bouts it moves,
 * each where the board put it. The server checks the whole batch — against
 * itself and against every bout it leaves where it is — before it writes a row.
 */
export const schedulePlacementsSchema = z
  .object({
    placements: z
      .array(placementSchema)
      .min(1)
      .max(PLACEMENTS_MAX)
      .refine((rows) => new Set(rows.map((row) => row.matchId)).size === rows.length, {
        message: 'Name each Match once',
      }),
  })
  .strict();

export class SchedulePlacementsDto extends createZodDto(schedulePlacementsSchema) {}
