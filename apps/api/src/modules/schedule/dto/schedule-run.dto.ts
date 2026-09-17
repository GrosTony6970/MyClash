import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { lengthMinutes } from '../../programme/dto/programme.dto';

/**
 * The ceiling on a typed bout length: one day. Zod's `.int()` lets 3 000 000 000
 * through, and Postgres INTEGER would refuse it row by row AFTER the piste check
 * had passed. On this body only — the sheet's own schema has no ceiling, and
 * adding one there would stop a stored sheet above it from loading.
 */
export const RUN_BOUT_LENGTH_MAX_MINUTES = 1440;

/**
 * The most Matches one run save names. The placement owner reads its batch with
 * one `.in('id', …)`, unsplit, so the list stays well inside a request URL.
 */
export const RUN_MAX_MATCHES = 200;

/**
 * The run window's save: these Matches, starting here, and — only when the
 * organiser changed it — this bout length (ADR-018). The server lays the run.
 *
 * `plannedDurationOverrideMinutes`: a number sets the length and re-lays the run
 * at it; `null` clears it and re-lays at the sheet's lengths; an absent key moves
 * the start only and keeps the spacing.
 */
export const scheduleRunSchema = z
  .object({
    matchIds: z
      .array(z.uuid())
      .min(1)
      .max(RUN_MAX_MATCHES)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Name each Match once',
      }),
    startAt: z.iso.datetime({ offset: true }),
    plannedDurationOverrideMinutes: lengthMinutes
      .max(RUN_BOUT_LENGTH_MAX_MINUTES)
      .nullable()
      .optional(),
  })
  .strict();

export class ScheduleRunDto extends createZodDto(scheduleRunSchema) {}
