import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PHOTO_QUEUE_FILTERS } from '@myclash/types';
import { csvDownloadQuerySchema } from '../../common/csv-download';

/**
 * `GET events/:eventId/photos/download`: at most one of a Tournament or a Workshop, and the
 * spreadsheet `photos.csv` is written for (`?csv=`, the one choice every CSV download offers).
 * Strict as the schema it extends: an unknown key is a 400.
 */
export const photoDownloadQuerySchema = csvDownloadQuerySchema
  .extend({ tournamentId: z.uuid().optional(), workshopId: z.uuid().optional() })
  .refine((query) => !(query.tournamentId && query.workshopId), {
    message: 'Download a Tournament or a Workshop, not both',
  });
export class PhotoDownloadQueryDto extends createZodDto(photoDownloadQuerySchema) {}

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
 * `POST …/photos/:photoId/keep` (organiser and staff): the newest report change the screen
 * showed, as the queue gave it (`lastReportAt`). Keep clears the reports not changed since
 * (rulings 457, 466).
 */
export const photoKeepBodySchema = z
  .object({ reportsUpTo: z.iso.datetime({ offset: true }) })
  .strict();
export class PhotoKeepBodyDto extends createZodDto(photoKeepBodySchema) {}
