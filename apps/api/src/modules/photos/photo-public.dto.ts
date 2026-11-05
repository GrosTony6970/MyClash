import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
