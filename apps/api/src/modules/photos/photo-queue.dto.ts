import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PHOTO_QUEUE_FILTERS } from '@myclash/types';

/**
 * `GET events/:eventId/photos`: which tab, and the previous page's cursor. The cursor is a row's
 * `created_at` as PostgREST wrote it (microseconds, `+00:00`), so the offset form is accepted.
 */
export const photoQueueQuerySchema = z
  .object({
    filter: z.enum(PHOTO_QUEUE_FILTERS).default('waiting'),
    before: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export class PhotoQueueQueryDto extends createZodDto(photoQueueQuerySchema) {}

/**
 * `POST …/photos/:photoId/keep` (organiser and staff): the newest report the screen showed, as
 * the queue gave it (`lastReportAt`). Keep clears the reports up to it (ruling 457).
 */
export const photoKeepBodySchema = z
  .object({ reportsUpTo: z.iso.datetime({ offset: true }) })
  .strict();
export class PhotoKeepBodyDto extends createZodDto(photoKeepBodySchema) {}
