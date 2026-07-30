import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
    status: z.enum(['scheduled', 'running', 'paused', 'completed', 'voided']),
    winnerRegistrationId: z.uuid().optional(),
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
    // both the offline outbox drain (offline/sync.ts) and the online post
    // (ScoringPad.tsx) build the body with `?? null`. Zod's `.optional()`
    // accepts undefined ONLY, so a clean hit — which carries no afterblow and
    // no no-exchange reason — was rejected with a 400, and the SyncEngine
    // DROPS a 400 as terminal. The referee's hit disappeared with a console
    // warning. The old class-validator `@IsOptional()` allowed null, so the
    // Zod migration silently changed this contract. Do not narrow these back.
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
  })
  .strict();
export class ResetMatchDto extends createZodDto(resetMatchSchema) {}

const createMatchForfeitSchema = z
  .object({
    forfeitingRegistrationId: z.uuid(),
    reason: z.enum(['injury', 'voluntary', 'black_card_1', 'black_card_2', 'conduct_violation']),
    canContinue: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();
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
