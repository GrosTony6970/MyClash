import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shared enums
const cardSchema = z.enum(['yellow', 'red', 'black']);
const accumulationScopeSchema = z.enum(['match', 'phase', 'tournament']);
const forfeitScopeSchema = z.enum(['match', 'tournament', 'none']);

export type BlackCardForfeitScopeDto = z.infer<typeof forfeitScopeSchema>;

const penaltyRulesetEntrySchema = z.object({
  groupNumber: z.number(),
  // String to allow alphanumeric rulebook IDs like "R7a" or "B-12".
  // Deeper validation (non-empty + safe-char + length) happens in the service.
  refNumber: z.string(),
  shortName: z.string(),
  description: z.string(),
  sanctions: z.array(cardSchema),
});

/**
 * Record a match penalty card. Either `rulesetEntryId` (a configured penalty
 * entry) or `directCard` (a manual referee card) must be provided; `reason` is
 * required when a manual `directCard` is given. Exported for unit testing of
 * this conditional logic.
 */
export const createPenaltySchema = z
  .object({
    clientUuid: z.uuid(),
    sequence: z.number().int().min(1),
    registrationId: z.uuid(),
    rulesetEntryId: z.uuid().optional(),
    directCard: cardSchema.optional(),
    occurredAt: z.iso.datetime(),
    /**
     * Match-clock position (accumulated active ms) when the penalty was
     * recorded. Persisted to match_penalties.clock_time_ms so the timeline
     * shows match-clock time.
     *
     * `.nullable()` as well as `.optional()`, because the pad sends an explicit
     * NULL whenever it has no clock to report: both penalty paths pass
     * `clockState?.activeMs ?? null` (MatchView.tsx), so a card recorded before
     * the clock GET resolves — or after it failed — carries a null. Zod's
     * `.optional()` accepts undefined ONLY, so that card was rejected with a
     * 400 and the referee saw a bare "Bad Request". Exactly the fault that made
     * every exchange type unrecordable (see the same note on
     * CreateExchangeDto); the exchange schema was fixed and this one, next to
     * it, was not. The service already writes `dto.clockTimeMs ?? null`. Do not
     * narrow this back.
     */
    clockTimeMs: z.number().int().min(0).nullable().optional(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.rulesetEntryId) || Boolean(d.directCard), {
    message: 'Either rulesetEntryId or directCard is required',
    path: ['rulesetEntryId'],
  })
  .refine((d) => !d.directCard || typeof d.reason === 'string', {
    message: 'reason is required when directCard is set',
    path: ['reason'],
  });
export class CreatePenaltyDto extends createZodDto(createPenaltySchema) {}

const voidPenaltySchema = z.object({ reason: z.string().max(500).optional() }).strict();
export class VoidPenaltyDto extends createZodDto(voidPenaltySchema) {}

const createPenaltyRulesetSchema = z
  .object({
    ownerOrganizationId: z.uuid(),
    code: z.string().max(100),
    version: z.string().max(50),
    name: z.string().max(200),
    description: z.string().optional(),
    accumulationScope: accumulationScopeSchema,
    publicVisibility: z.boolean(),
    entries: z.array(penaltyRulesetEntrySchema),
    yellowCardPoints: z.number().optional(),
    redCardPoints: z.number().optional(),
    blackCardPoints: z.number().optional(),
    firstBlackCardForfeit: forfeitScopeSchema.optional(),
    secondBlackCardForfeit: forfeitScopeSchema.optional(),
  })
  .strict();
export class CreatePenaltyRulesetDto extends createZodDto(createPenaltyRulesetSchema) {}

const importPenaltyRulesetCsvSchema = z
  .object({
    ownerOrganizationId: z.uuid().optional(),
    eventId: z.uuid().optional(),
    code: z.string(),
    version: z.string(),
    name: z.string(),
    accumulationScope: accumulationScopeSchema,
    csv: z.string(),
  })
  .strict();
export class ImportPenaltyRulesetCsvDto extends createZodDto(importPenaltyRulesetCsvSchema) {}

const updatePenaltyRulesetSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().optional(),
    accumulationScope: accumulationScopeSchema.optional(),
    publicVisibility: z.boolean().optional(),
    /**
     * Full replacement set of entries. When provided, the service deletes any
     * existing entries for this ruleset and inserts these. Omit to leave
     * entries untouched.
     */
    entries: z.array(penaltyRulesetEntrySchema).optional(),
    yellowCardPoints: z.number().optional(),
    redCardPoints: z.number().optional(),
    blackCardPoints: z.number().optional(),
    firstBlackCardForfeit: forfeitScopeSchema.optional(),
    secondBlackCardForfeit: forfeitScopeSchema.optional(),
  })
  .strict();
export class UpdatePenaltyRulesetDto extends createZodDto(updatePenaltyRulesetSchema) {}

/**
 * R3: payload for super-admin rejection of a penalty-ruleset sharing request.
 * The reason is shown to the organizer so they can fix the issue and resubmit.
 */
const rejectPenaltyRulesetSharingSchema = z.object({ reason: z.string().max(1000) }).strict();
export class RejectPenaltyRulesetSharingDto extends createZodDto(
  rejectPenaltyRulesetSharingSchema,
) {}

const assignPenaltyRulesetSchema = z.object({ penaltyRulesetId: z.uuid().nullish() }).strict();
export class AssignPenaltyRulesetDto extends createZodDto(assignPenaltyRulesetSchema) {}

/**
 * Publish the current definition as an immutable version. `version` optionally
 * overrides the auto patch-bump (e.g. a deliberate minor/major bump).
 */
const publishPenaltyRulesetSchema = z.object({ version: z.string().max(50).optional() }).strict();
export class PublishPenaltyRulesetDto extends createZodDto(publishPenaltyRulesetSchema) {}

/** Restore a prior snapshot (by version-row id) onto the parent ruleset. */
const rollbackPenaltyRulesetSchema = z.object({ versionId: z.uuid() }).strict();
export class RollbackPenaltyRulesetDto extends createZodDto(rollbackPenaltyRulesetSchema) {}

const reviewPenaltySchema = z.object({ status: z.enum(['confirmed', 'dismissed']) }).strict();
export class ReviewPenaltyDto extends createZodDto(reviewPenaltySchema) {}
