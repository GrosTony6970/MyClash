import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ForfeitReasonSchema, isOverrideReason } from '@myclash/rulesets';

const createMatchSchema = z
  .object({
    phaseId: z.uuid(),
    poolId: z.uuid().optional(),
    liceId: z.uuid().optional(),
    redRegistrationId: z.uuid(),
    blueRegistrationId: z.uuid(),
    scheduledAt: z.iso.datetime().optional(),
    rulesetCode: z.string().optional(),
    rulesetVersion: z.string().optional(),
    matchNumberLabel: z.string().optional(),
  })
  .strict();
export class CreateMatchDto extends createZodDto(createMatchSchema) {}

const updateMatchStatusSchema = z
  .object({
    /**
     * No 'voided'. `voidMatch` was literally `updateStatus({status:'voided'})`,
     * so this route was a second door to the same destructive place — gated at
     * scorekeeper, while `POST /matches/:id/void` is gated at organizer. An
     * assigned pad staff token could walk through it, and after the
     * un-completion owner landed that door led to discarding later bouts.
     * One door, one gate: void goes through its own route.
     */
    status: z.enum(['scheduled', 'running', 'paused', 'completed']),
    winnerRegistrationId: z.uuid().optional(),
    /** See `ResetMatchDto` — same acknowledgement, same 403 without the capability. */
    discardDependentResults: z.boolean().optional(),
  })
  .strict();
export class UpdateMatchStatusDto extends createZodDto(updateMatchStatusSchema) {}

const createExchangeSchema = z
  .object({
    /**
     * Client-generated UUID for idempotency.
     * The server will upsert on this UUID — inserting the same exchange twice
     * is a no-op. This is what makes offline-first sync safe.
     */
    clientUuid: z.uuid(),
    sequence: z.number().int().min(1),
    type: z.enum(['clean', 'afterblow', 'double', 'no_exchange']),
    occurredAt: z.iso.datetime(),
    /**
     * Match-clock position (accumulated active ms) when the exchange was
     * recorded. Persisted to exchanges.clock_time_ms so the timeline can
     * show match-clock time rather than wall-clock. Sent by the scoring
     * pad on every exchange — the field MUST be whitelisted here or the
     * global forbidNonWhitelisted pipe rejects the whole POST with a 400.
     */
    //
    // Every optional field below is `.nullable()` as well, because the scoring
    // pad sends explicit NULLs for the fields an exchange type does not use:
    // the outbox drain (`apps/web-staff/src/offline/sync.ts`, the pad's ONE
    // post path) builds the body with `?? null`. Zod's `.optional()` accepts
    // undefined ONLY, so a clean hit — which carries no afterblow and no
    // no-exchange reason — was rejected with a 400, and the SyncEngine treated
    // a 400 as terminal and DROPPED the hit with a console warning. The old
    // class-validator `@IsOptional()` allowed null, so the Zod migration
    // silently changed this contract. Do not narrow these back.
    clockTimeMs: z.number().int().min(0).nullable().optional(),
    durationSincePrevMs: z.number().int().nullable().optional(),
    firstStrikerColor: z.enum(['red', 'blue']).nullable().optional(),
    firstStrikeValue: z.number().int().min(1).max(10).nullable().optional(),
    // Deductive afterblow mode awards the defender 0, so this MUST allow 0 —
    // and a min of 1 would 400 the whole POST. The cap is raised to 10 so
    // configurable button point values pass.
    afterblowValue: z.number().int().min(0).max(10).nullable().optional(),
    noExchangeReason: z.string().nullable().optional(),
  })
  .strict();
export class CreateExchangeDto extends createZodDto(createExchangeSchema) {}

const voidExchangeSchema = z.object({ reason: z.string().optional() }).strict();
export class VoidExchangeDto extends createZodDto(voidExchangeSchema) {}

const editExchangeSchema = z
  .object({
    type: z.enum(['clean', 'afterblow', 'double', 'no_exchange']),
    firstStrikerColor: z.enum(['red', 'blue']).optional(),
    firstStrikeValue: z.number().int().min(1).max(10).optional(),
    // Deductive afterblow mode awards the defender 0, so this MUST allow 0 —
    // and a min of 1 would 400 the whole POST. The cap is raised to 10 so
    // configurable button point values pass.
    afterblowValue: z.number().int().min(0).max(10).optional(),
    noExchangeReason: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
export class EditExchangeDto extends createZodDto(editExchangeSchema) {}

const resetMatchSchema = z
  .object({
    confirmation: z.string(),
    reason: z.string().optional(),
    /**
     * "Yes, discard the later bouts this invalidates."
     *
     * Refused with 403 unless the actor holds `canDiscardDependentResults`, so
     * the capability is enforced server-side rather than by hiding a checkbox.
     * Without it the reset is refused with a 409 naming how many bouts would be
     * lost — the pre-flight read exists so the operator sees that first.
     */
    discardDependentResults: z.boolean().optional(),
  })
  .strict();
export class ResetMatchDto extends createZodDto(resetMatchSchema) {}

/**
 * Records a forfeit OR a result override — `reason` says which.
 *
 * `reason` comes from `@myclash/rulesets` rather than a literal list: this
 * enum was duplicated here and drifted out of sight of the engine that owns
 * it. One owner, imported.
 *
 * `forfeitingRegistrationId` reads as "the side recorded as losing" on the
 * override path. Nobody forfeited, but the column, the winner derivation and
 * the void path are all shared, so the shape is too.
 */
const createMatchForfeitSchema = z
  .object({
    forfeitingRegistrationId: z.uuid(),
    reason: ForfeitReasonSchema,
    canContinue: z.boolean().optional(),
    note: z.string().optional(),
    /**
     * The real result, for an override only. A correction exists to state a
     * score the derivation got wrong, so it cannot come from the ruleset's
     * per-reason policy.
     */
    explicitScores: z
      .object({
        forfeitingScore: z.number().int().min(0),
        opponentScore: z.number().int().min(0),
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const override = isOverrideReason(value.reason);

    if (override && !value.explicitScores) {
      ctx.addIssue({
        code: 'custom',
        path: ['explicitScores'],
        message: 'explicitScores is required for an override reason',
      });
    }
    if (!override && value.explicitScores) {
      ctx.addIssue({
        code: 'custom',
        path: ['explicitScores'],
        message: 'explicitScores is only accepted for an override reason',
      });
    }
    // An override never withdraws anyone — accepting the flag would imply it
    // could. See DEFAULT_FORFEIT_POLICY: every override is 'match_only'.
    if (override && value.canContinue !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['canContinue'],
        message: 'canContinue is not accepted for an override reason',
      });
    }
  });
export class CreateMatchForfeitDto extends createZodDto(createMatchForfeitSchema) {}

const adjustClockSchema = z
  .object({
    adjustmentMs: z.number().int(),
    reason: z.string().optional(),
  })
  .strict();
export class AdjustClockDto extends createZodDto(adjustClockSchema) {}

const updateMatchSchema = z
  .object({
    liceId: z.uuid().nullish(),
    refereeId: z.uuid().nullish(),
  })
  .strict();
export class UpdateMatchDto extends createZodDto(updateMatchSchema) {}
