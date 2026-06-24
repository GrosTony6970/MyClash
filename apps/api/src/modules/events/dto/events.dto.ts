import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createEventSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens'),
    startDate: z.string(),
    endDate: z.string(),
    city: z.string().max(500).nullable().optional(),
    // ISO 3166-1 alpha-2 country code
    country: z.string().min(2).max(2).nullable().optional(),
    publicLandingMd: z.string().optional(),
  })
  .strict();
export class CreateEventDto extends createZodDto(createEventSchema) {}

const updateEventSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    city: z.string().max(500).nullable().optional(),
    // ISO 3166-1 alpha-2 country code
    country: z.string().min(2).max(2).nullable().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    // IANA timezone
    timezone: z.string().max(64).optional(),
    publicLandingMd: z.string().optional(),
    status: z.enum(['draft', 'published', 'running', 'completed', 'archived']).optional(),
    // Public URL of the event logo (set by the upload endpoint).
    logoUrl: z.string().max(500).nullish(),
    // AI spend cap in EUR for this event (null = no cap)
    aiSpendCapEur: z.number().min(0).nullish(),
  })
  .strict();
export class UpdateEventDto extends createZodDto(updateEventSchema) {}

const upsertEventThemeSchema = z
  .object({
    // logoUrl + heroImageUrl are the only per-event identity affordances
    // that remain. Per-event color overrides + font pickers + custom CSS
    // were retired in migration 0086 — the unified MyClash design is now
    // governed by @myclash/design-tokens across both apps.
    logoUrl: z.string().nullish(),
    heroImageUrl: z.string().nullish(),
  })
  .strict();
export class UpsertEventThemeDto extends createZodDto(upsertEventThemeSchema) {}

const eventQuerySchema = z
  .object({
    status: z.string().optional(),
    organizationId: z.uuid().optional(),
    /**
     * Hard cap on rows returned. Defaults to 100 (also the max). Spectators
     * poll this endpoint every ~30 s; without a cap the per-poll payload
     * grew linearly with deploy size. Query values arrive as strings, so
     * coerce before validating the numeric bounds.
     */
    limit: z.coerce.number().min(1).max(100).optional(),
    /**
     * Pagination cursor — an ISO date string. The next page returns events
     * whose start_date is strictly less than the cursor. Pair with the
     * default `order by start_date desc` so the cursor walks backward in
     * time deterministically.
     */
    cursor: z.string().optional(),
  })
  .strict();
export class EventQueryDto extends createZodDto(eventQuerySchema) {}

const eventClubQuerySchema = z
  .object({
    scope: z.enum(['all', 'event']).optional(),
    q: z.string().max(100).optional(),
  })
  .strict();
export class EventClubQueryDto extends createZodDto(eventClubQuerySchema) {}

const submitEventClubRequestSchema = z
  .object({
    name: z.string().min(2).max(100),
    abbreviation: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    countryCode: z.string().max(100).optional(),
    website: z.string().max(255).optional(),
    logoUrl: z.string().optional(),
  })
  .strict();
export class SubmitEventClubRequestDto extends createZodDto(submitEventClubRequestSchema) {}

const targetValuesSchema = z
  .object({
    deepTarget: z.number().min(0).max(20).optional(),
    shallowTarget: z.number().min(0).max(20).optional(),
  })
  .strict();

/**
 * Tournament-level policy switches set by the wizard's Step 4.
 *
 * Renamed from `forfeitPolicy` because that name collided with the
 * rulesets-engine `forfeitPolicy.reasons.*` blob (per-reason scoring data) —
 * same JSON key, totally different shape. The collision tripped a 400 on the
 * wizard's final PATCH whenever the persisted row carried the engine shape.
 * Migration 0062 moves any legacy wizard-shape rows from `forfeitPolicy` to
 * `tournamentPolicy`.
 */
const tournamentPolicySchema = z
  .object({
    forfeitDrawsCount: z.boolean().optional(),
    forfeitFighterBefore1stMatch: z.boolean().optional(),
    disqualifyAfter: z.number().min(1).max(10).optional(),
  })
  .strict();

const timeLimitsSecondsSchema = z
  .object({
    pool: z.number().min(0).max(3600).nullish(),
    bracket: z.number().min(0).max(3600).nullish(),
    finals: z.number().min(0).max(3600).nullish(),
  })
  .strict();

/**
 * Match-format payload sent by the tournament creation wizard (Step 2)
 * and the per-tournament settings page. Persisted under
 * `tournaments.ruleset_config.matchFormat`. Field bounds mirror the
 * input clamps in `Step2MatchFormat.tsx`.
 */
const matchFormatSchema = z
  .object({
    pointCap: z.number().min(1).max(50).optional(),
    timerMode: z.enum(['countdown', 'countup']).optional(),
    timeLimitsSeconds: timeLimitsSecondsSchema.optional(),
    softClockLimitSeconds: z.number().min(0).max(600).optional(),
    maxDoubleHits: z.number().min(0).max(20).nullish(),
    scoringDirection: z.enum(['normal', 'reverse_zero_loses']).optional(),
  })
  .strict();

const tournamentRulesetConfigSchema = z
  .object({
    winBonus: z.number().min(0).max(20).optional(),
    targetValues: targetValuesSchema.optional(),
    tournamentPolicy: tournamentPolicySchema.optional(),
    matchFormat: matchFormatSchema.optional(),
  })
  .strict();

const tournamentLockConfigSchema = z
  .object({
    autoLockEnabled: z.boolean().optional(),
    autoLockDelayMinutes: z.number().min(0).max(1440).optional(),
    autoLockCompletedPools: z.boolean().optional(),
    autoLockCompletedBrackets: z.boolean().optional(),
  })
  .strict();

const createTournamentSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens'),
    weapon: z.string().optional(),
    rulesetCode: z.string().optional(),
    rulesetVersion: z.string().optional(),
    rulesetConfig: tournamentRulesetConfigSchema.optional(),
    lockConfig: tournamentLockConfigSchema.optional(),
    scoringConfig: z.record(z.string(), z.unknown()).optional(),
    penaltyRulesetId: z.uuid().optional(),
    // Tournament identity color token (e.g. "red", "amber"). Rendered as a
    // small bubble next to the tournament name across the admin UI.
    color: z.string().max(32).optional(),
    /**
     * Capacity caps — surfaced in the create wizard alongside the
     * other Step 1 basics. Null (or omitted) = no cap, matching the
     * settings page semantics on UpdateTournamentDto.
     */
    maxParticipants: z.number().min(1).nullish(),
    maxWaitlist: z.number().min(0).nullish(),
  })
  .strict();
export class CreateTournamentDto extends createZodDto(createTournamentSchema) {}

const updateTournamentSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    weapon: z.string().optional(),
    status: z.enum(['draft', 'published', 'running', 'completed', 'archived']).optional(),
    // Tournament scoring configuration (afterblow mode + button config)
    scoringConfig: z.record(z.string(), z.unknown()).optional(),
    // Tournament ruleset configuration, including shared match format settings
    rulesetConfig: tournamentRulesetConfigSchema.optional(),
    // Tournament match lock and auto-lock configuration
    lockConfig: tournamentLockConfigSchema.optional(),
    penaltyRulesetId: z.uuid().nullish(),
    // Public URL of the tournament logo. Pass null to clear.
    logoUrl: z.string().max(2048).nullish(),
    rulesetCode: z.string().max(50).optional(),
    rulesetVersion: z.string().max(20).optional(),
    // Tournament identity color token (e.g. "red", "amber"). Pass null to clear.
    color: z.string().max(32).nullish(),
    /**
     * Slice 4 of the capacity overhaul: max number of registered + checked-in
     * fighters. Null = no cap (current behaviour). When set, the registrations
     * create endpoint returns 409 reason='tournament_full' once the count
     * meets this value.
     */
    maxParticipants: z.number().min(1).nullish(),
    // Slice 4: max waitlist size. Null = no cap.
    maxWaitlist: z.number().min(0).nullish(),
  })
  .strict();
export class UpdateTournamentDto extends createZodDto(updateTournamentSchema) {}
