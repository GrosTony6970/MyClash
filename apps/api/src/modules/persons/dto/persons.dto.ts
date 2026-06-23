import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `clubId` and `newClubName` are mutually exclusive; when `newClubName` is
 * provided it must be a non-empty trimmed string. Exported for unit testing.
 */
// Optional fields are `.nullable()` because the add/edit forms send `null`
// (not `undefined`) to mean "no value" — e.g. `email: addForm.email.trim() ||
// null`. Treat null and undefined alike: both mean "field absent". The service
// already coalesces null → DB NULL.
export const createPersonSchema = z
  .object({
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    email: z.email().nullable().optional(),
    clubId: z.uuid().nullable().optional(),
    // Auto-create a new club with this name (unverified) and attach the
    // participant. Mutually exclusive with clubId.
    newClubName: z.string().max(200).nullable().optional(),
    hemaRatingsId: z.string().nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    genderCategory: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    globalPersonId: z.uuid().nullable().optional(),
  })
  .strict()
  // `!= null` treats both null and undefined as "no club name" so picking an
  // existing club (which sends newClubName: null) doesn't trip this.
  .refine((d) => !(d.clubId && d.newClubName != null), {
    message: 'clubId and newClubName are mutually exclusive',
    path: ['newClubName'],
  })
  .refine((d) => d.newClubName == null || d.newClubName.trim().length > 0, {
    message: 'newClubName must be a non-empty trimmed string',
    path: ['newClubName'],
  });
export class CreatePersonDto extends createZodDto(createPersonSchema) {}

// givenName / familyName stay non-nullable (the service trims them and the
// form never clears a name); the rest are `.nullable()` so the edit form can
// blank a field by sending null (see createPersonSchema note above).
export const updatePersonSchema = z
  .object({
    givenName: z.string().min(1).max(100).optional(),
    familyName: z.string().min(1).max(100).optional(),
    email: z.email().nullable().optional(),
    clubId: z.uuid().nullable().optional(),
    hemaRatingsId: z.string().nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    genderCategory: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export class UpdatePersonDto extends createZodDto(updatePersonSchema) {}

const importDecisionSchema = z
  .object({
    rowIndex: z.number(),
    action: z.enum(['link', 'create_new']),
    globalPersonId: z.uuid().optional(),
  })
  .strict();
export class ImportDecisionDto extends createZodDto(importDecisionSchema) {}
