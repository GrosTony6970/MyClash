import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `clubId` and `newClubName` are mutually exclusive; when `newClubName` is
 * provided it must be a non-empty trimmed string. Exported for unit testing.
 */
export const createPersonSchema = z
  .object({
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    email: z.email().optional(),
    clubId: z.uuid().optional(),
    // Auto-create a new club with this name (unverified) and attach the
    // participant. Mutually exclusive with clubId.
    newClubName: z.string().max(200).optional(),
    hemaRatingsId: z.string().optional(),
    dateOfBirth: z.string().optional(),
    genderCategory: z.string().optional(),
    notes: z.string().max(2000).optional(),
    globalPersonId: z.uuid().optional(),
  })
  .strict()
  .refine((d) => !(d.clubId && d.newClubName !== undefined), {
    message: 'clubId and newClubName are mutually exclusive',
    path: ['newClubName'],
  })
  .refine((d) => d.newClubName === undefined || d.newClubName.trim().length > 0, {
    message: 'newClubName must be a non-empty trimmed string',
    path: ['newClubName'],
  });
export class CreatePersonDto extends createZodDto(createPersonSchema) {}

const updatePersonSchema = z
  .object({
    givenName: z.string().min(1).max(100).optional(),
    familyName: z.string().min(1).max(100).optional(),
    email: z.email().optional(),
    clubId: z.uuid().optional(),
    hemaRatingsId: z.string().optional(),
    dateOfBirth: z.string().optional(),
    genderCategory: z.string().optional(),
    notes: z.string().max(2000).optional(),
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
