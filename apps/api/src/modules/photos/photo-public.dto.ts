import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PHOTO_REPORT_COMMENT_MAX } from '@myclash/types';

/**
 * `GET events/:eventId/photos/public`: the previous page's cursor (a row's `created_at` as
 * PostgREST wrote it, so the offset form is accepted), and at most one of a Tournament or a
 * Workshop to show the photos of.
 */
export const publicPhotoQuerySchema = z
  .object({
    before: z.iso.datetime({ offset: true }).optional(),
    tournamentId: z.uuid().optional(),
    workshopId: z.uuid().optional(),
  })
  .strict()
  .refine((query) => !(query.tournamentId && query.workshopId), {
    message: 'Filter by a Tournament or a Workshop, not both',
  });
export class PublicPhotoQueryDto extends createZodDto(publicPhotoQuerySchema) {}

export type PublicPhotoQuery = z.infer<typeof publicPhotoQuerySchema>;

/**
 * `POST events/:eventId/photos/:photoId/report`: why the phone reports the photo, optional
 * (ruling 452). Trimmed; a comment of spaces reaches the handler as `''`, which stores none.
 * Counted in characters, as a caption and Postgres' `char_length` count them (an emoji is one).
 * A NUL is refused here: Postgres refuses it in text, which would answer a 500.
 */
const reportComment = z
  .string()
  .trim()
  .refine((text) => [...text].length <= PHOTO_REPORT_COMMENT_MAX, {
    message: `Keep it to ${PHOTO_REPORT_COMMENT_MAX} characters`,
  })
  .refine((text) => !text.includes('\u0000'), { message: 'A comment cannot hold a NUL' });

export const photoReportBodySchema = z
  .object({ comment: reportComment.nullable().optional() })
  .strict();
export class PhotoReportBodyDto extends createZodDto(photoReportBodySchema) {}
