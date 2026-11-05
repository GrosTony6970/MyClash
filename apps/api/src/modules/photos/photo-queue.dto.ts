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
