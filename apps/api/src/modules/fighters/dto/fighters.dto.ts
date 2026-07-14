import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createFighterSchema = z
  .object({
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    displayName: z.string().min(1).max(200),
    clubId: z.uuid().optional(),
    countryCode: z.string().max(2).optional(),
    hemaRatingsId: z.string().optional(),
    photoUrl: z.string().optional(),
    bio: z.string().max(2000).optional(),
    dateOfBirth: z.string().optional(),
    genderCategory: z.string().optional(),
  })
  .strict();
export class CreateFighterDto extends createZodDto(createFighterSchema) {}

const updateFighterSchema = z
  .object({
    givenName: z.string().min(1).max(100).optional(),
    familyName: z.string().min(1).max(100).optional(),
    displayName: z.string().min(1).max(200).optional(),
    clubId: z.uuid().optional(),
    countryCode: z.string().max(2).optional(),
    hemaRatingsId: z.string().optional(),
    photoUrl: z.string().optional(),
    bio: z.string().max(2000).optional(),
    dateOfBirth: z.string().optional(),
    // Public-profile identity fields. `.nullable().optional()` so the FE can send
    // `null` to clear (see project_zod_null_to_clear); a plain `.optional()` would
    // reject the null. Links are stored as free text (not `.url()`-validated) so a
    // half-typed value isn't rejected mid-edit; the service coerces '' → null.
    alias: z.string().max(100).nullable().optional(),
    websiteUrl: z.string().max(300).nullable().optional(),
    instagramUrl: z.string().max(300).nullable().optional(),
    youtubeUrl: z.string().max(300).nullable().optional(),
    practicingSinceYear: z.number().int().min(1900).max(2100).nullable().optional(),
    // Per-field public visibility map ({ fieldKey: boolean }). Unknown keys are
    // dropped server-side; only whitelisted fields are persisted.
    publicVisibility: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();
export class UpdateFighterDto extends createZodDto(updateFighterSchema) {}

const fighterClubInputSchema = z
  .object({
    clubId: z.uuid().optional(),
    clubName: z.string().max(200).optional(),
  })
  .strict();
export class FighterClubInputDto extends createZodDto(fighterClubInputSchema) {}

const fighterWeaponInputSchema = z
  .object({
    weaponId: z.uuid().optional(),
    weaponName: z.string().max(100).optional(),
    favorite: z.boolean().optional(),
    // `.nullable()` so the FE can send `null` to clear a previously set level
    // (a plain `.optional()` would reject it — see project_zod_null_to_clear).
    level: z.enum(['just_for_fun', 'beginner', 'intermediate', 'advanced']).nullable().optional(),
    // Free-text style/tradition per weapon (e.g. "KDF", "Italian longsword"); UI
    // offers suggestions via a datalist but any value is allowed.
    style: z.string().max(100).nullable().optional(),
  })
  .strict();
export class FighterWeaponInputDto extends createZodDto(fighterWeaponInputSchema) {}

// A manually imported podium from a tournament not run in the app. `weapon` is
// the controlled catalog name the FE picks; stored as free text alongside the
// tournament-derived weapon strings.
const fighterMedalInputSchema = z
  .object({
    competition: z.string().min(1).max(200),
    year: z.number().int().min(1900).max(2100),
    rank: z.number().int().min(1).max(3),
    weapon: z.string().min(1).max(100),
  })
  .strict();
export class FighterMedalInputDto extends createZodDto(fighterMedalInputSchema) {}

// Extends UpdateFighterDto's fields plus the global-profile editing payload.
// The nested club/weapon arrays were only shape-checked as arrays under
// class-validator (no @ValidateNested), so the element schemas here stay
// permissive and merely document the shape the service reads.
const updateMyFighterProfileSchema = updateFighterSchema
  .extend({
    fighterId: z.uuid(),
    mainClub: fighterClubInputSchema.optional(),
    secondaryClubs: z.array(fighterClubInputSchema).optional(),
    previousClubs: z.array(fighterClubInputSchema).optional(),
    weapons: z.array(fighterWeaponInputSchema).optional(),
    medals: z.array(fighterMedalInputSchema).optional(),
  })
  .strict();
export class UpdateMyFighterProfileDto extends createZodDto(updateMyFighterProfileSchema) {}

const fighterQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    club: z.string().optional(),
  })
  .strict();
export class FighterQueryDto extends createZodDto(fighterQuerySchema) {}

const promoteFighterSchema = z.object({ personId: z.uuid() }).strict();
export class PromoteFighterDto extends createZodDto(promoteFighterSchema) {}

const mergeFightersSchema = z
  .object({
    sourceId: z.uuid(),
    targetId: z.uuid(),
    reason: z.string().max(500).optional(),
  })
  .strict();
export class MergeFightersDto extends createZodDto(mergeFightersSchema) {}

const createGlobalPersonSchema = z
  .object({
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    displayName: z.string().max(200).optional(),
    clubId: z.uuid().nullish(),
    clubName: z.string().max(200).optional(),
    clubAbbreviation: z.string().max(20).optional(),
    clubCity: z.string().max(100).optional(),
    hemaRatingsId: z.string().max(100).optional(),
    email: z.email().max(254).optional(),
    // ISO YYYY-MM-DD
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be ISO YYYY-MM-DD')
      .optional(),
    isFighter: z.boolean().optional(),
    isReferee: z.boolean().optional(),
    isWorkshopParticipant: z.boolean().optional(),
    isInstructor: z.boolean().optional(),
  })
  .strict();
export class CreateGlobalPersonDto extends createZodDto(createGlobalPersonSchema) {}

const updateGlobalPersonSchema = z
  .object({
    givenName: z.string().min(1).max(100).optional(),
    familyName: z.string().min(1).max(100).optional(),
    displayName: z.string().max(200).optional(),
    clubId: z.uuid().nullish(),
    clubName: z.string().max(200).optional(),
    clubAbbreviation: z.string().max(20).optional(),
    clubCity: z.string().max(100).optional(),
    hemaRatingsId: z.string().max(100).nullish(),
    // @ValidateIf skipped validation when value was null or '' — replicate by
    // accepting null/'' and only enforcing email shape on other strings.
    email: z.union([z.email().max(254), z.literal(''), z.null()]).optional(),
    // Likewise skipped for null/'' — accept those, else require ISO YYYY-MM-DD.
    dateOfBirth: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be ISO YYYY-MM-DD'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    isFighter: z.boolean().optional(),
    isReferee: z.boolean().optional(),
    isWorkshopParticipant: z.boolean().optional(),
    isInstructor: z.boolean().optional(),
  })
  .strict();
export class UpdateGlobalPersonDto extends createZodDto(updateGlobalPersonSchema) {}

const fighterRolesSchema = z
  .object({
    isFighter: z.boolean().optional(),
    isReferee: z.boolean().optional(),
    isWorkshopParticipant: z.boolean().optional(),
    isInstructor: z.boolean().optional(),
  })
  .strict();
export class FighterRolesDto extends createZodDto(fighterRolesSchema) {}

const globalPersonQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    roles: z.array(z.enum(['fighter', 'referee', 'workshop_participant', 'instructor'])).optional(),
  })
  .strict();
export class GlobalPersonQueryDto extends createZodDto(globalPersonQuerySchema) {}

const refereeProfileSchema = z
  .object({
    certifications: z.array(z.object({}).loose()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export class RefereeProfileDto extends createZodDto(refereeProfileSchema) {}

const linkQualificationSchema = z.object({ qualificationId: z.uuid() }).strict();
export class LinkQualificationDto extends createZodDto(linkQualificationSchema) {}

const linkEnrollmentSchema = z.object({ enrollmentId: z.uuid() }).strict();
export class LinkEnrollmentDto extends createZodDto(linkEnrollmentSchema) {}

const importDecisionSchema = z
  .object({
    index: z.number().int().min(0),
    action: z.enum(['skip', 'create_new', 'overwrite']),
    targetGlobalPersonId: z.uuid().optional(),
    givenName: z.string(),
    familyName: z.string(),
    displayName: z.string().optional(),
    hemaRatingsId: z.string().optional(),
    email: z.string().optional(),
    // ISO YYYY-MM-DD
    dateOfBirth: z.string().optional(),
    clubLabel: z.string().optional(),
    clubAbbreviation: z.string().optional(),
    clubCity: z.string().optional(),
    genderCategory: z.string().optional(),
    // Pipe-separated weapons, first = favorite, optional level:
    // "Longsword:intermediate|Rapier". Set only on freshly created profiles.
    weapons: z.string().optional(),
    isFighter: z.boolean(),
    isReferee: z.boolean(),
    isWorkshopParticipant: z.boolean(),
    // Optional (unlike its siblings): the CSV import flow does not yet carry an
    // is_instructor column, so decisions without it stay valid and default false.
    isInstructor: z.boolean().optional(),
  })
  .strict();
export class ImportDecisionDto extends createZodDto(importDecisionSchema) {}

const importCommitSchema = z
  .object({
    decisions: z.array(importDecisionSchema),
  })
  .strict();
export class ImportCommitDto extends createZodDto(importCommitSchema) {}
