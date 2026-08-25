import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthoredTargetsSchema, MAX_AUTHORED_TARGET_VALUE } from '@myclash/rulesets';
import { EVENT_KINDS } from '@myclash/types';

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
    // Nullish: the FE edit form sends `publicLandingMd: value || null`, so a
    // bare `.optional()` 400'd the whole payload for empty descriptions.
    publicLandingMd: z.string().nullish(),
    // What the event is (migration 0162). Defaults to 'standard'.
    //   standard — public, results are rated, protected from hard delete
    //   test     — dry run: hidden everywhere, unrated, disposable
    //   club     — internal club activity: public and visible in /me, but
    //              unrated (no rankings, career stats or HEMA Ratings) and
    //              still disposable
    eventKind: z.enum(EVENT_KINDS).optional(),
  })
  .strict();
export class CreateEventDto extends createZodDto(createEventSchema) {}

const updateEventSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens')
      .optional(),
    city: z.string().max(500).nullable().optional(),
    // ISO 3166-1 alpha-2 country code
    country: z.string().min(2).max(2).nullable().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    // IANA timezone
    timezone: z.string().max(64).optional(),
    // Nullish: null clears the landing description (FE sends `value || null`).
    publicLandingMd: z.string().nullish(),
    status: z.enum(['draft', 'published', 'running', 'completed', 'archived']).optional(),
    // Public URL of the event logo (set by the upload endpoint).
    logoUrl: z.string().max(500).nullish(),
    // AI spend cap in EUR for this event (null = no cap)
    aiSpendCapEur: z.number().min(0).nullish(),
    // Change the event kind (see CreateEventDto). Flipping between a rated and
    // an unrated kind recomputes any league this event feeds.
    eventKind: z.enum(EVENT_KINDS).optional(),
  })
  .strict();
export class UpdateEventDto extends createZodDto(updateEventSchema) {}

const upsertEventThemeSchema = z
  .object({
    // logoUrl + heroImageUrl are the only per-event identity affordances
    // that remain. Per-event color overrides + font pickers + custom CSS
    // were retired in migration 0086 — the unified MyClash design is now
    // governed by DESIGN.md / packages/ui/src/theme.css across both apps.
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
    /**
     * Free text over the event name, city, country and the ORGANISER's name.
     * The organiser term can't ride in the same PostgREST `.or()` as the event
     * columns (there is no cross-table OR), so the service resolves it to a
     * bounded id list first — see listEvents.
     */
    q: z.string().trim().max(100).optional(),
    /** ISO 3166-1 alpha-2. events.country stores the code, not the name. */
    country: z.string().trim().length(2).optional(),
    /**
     * weapon_catalog SLUG (what GET /weapons returns). There is no
     * events.weapon — weapon lives on tournaments, so this filters through an
     * inner embed. An unknown slug yields an empty list rather than a 400:
     * these are bookmarked, shared public URLs, and a retired weapon should
     * degrade to "no results", not an error page.
     */
    weapon: z.string().trim().max(100).optional(),
    /** Inclusive window start, YYYY-MM-DD. Matches events that OVERLAP it. */
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Inclusive window end, YYYY-MM-DD. */
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
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

/**
 * @deprecated Superseded by `targets`. Kept so the settings tab and wizard keep
 * saving while they migrate to the named-target editor.
 *
 * Bounds now match what the engine and the scoring pad can actually accept.
 * They previously read `min(0).max(20)` on a plain `z.number()`, which let
 * three organizer spinners send values the save then rejected:
 *   - 0 passed here and failed `TFv1ConfigSchema`'s `.positive()`, surfacing as
 *     a raw Zod message on a field whose own input allowed 0;
 *   - anything above 10 passed here and produced a scoring button that 400s
 *     the exchange POST, which the offline queue drops as terminal.
 */
const targetValuesSchema = z
  .object({
    deepTarget: z.number().int().min(1).max(MAX_AUTHORED_TARGET_VALUE).optional(),
    shallowTarget: z.number().int().min(1).max(MAX_AUTHORED_TARGET_VALUE).optional(),
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
    disqualifyAfter: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const timeLimitsSecondsSchema = z
  .object({
    pool: z.number().min(0).max(3600).nullish(),
    bracket: z.number().min(0).max(3600).nullish(),
    finals: z.number().min(0).max(3600).nullish(),
  })
  .strict();

// Per-phase best-of-N rounds. Odd integers (1 = single round); mirrors the
// rulesets BestOfConfigSchema so the wizard PATCH round-trips into
// ruleset_config.matchFormat.bestOf.
const bestOfValue = z
  .number()
  .int()
  .min(1)
  .max(15)
  .refine((n) => n % 2 === 1, 'bestOf must be an odd number');
const bestOfSchema = z
  .object({
    pool: bestOfValue.optional(),
    bracket: bestOfValue.optional(),
    finals: bestOfValue.optional(),
  })
  .strict();

/**
 * What a LEVEL bout is worth, per phase — an ordered chain of remedies the
 * referee works down until someone leads. Mirrors the rulesets
 * `LevelAtTimeConfigSchema` so the editor's PATCH round-trips into
 * `ruleset_config.matchFormat.levelAtTime`.
 *
 * The refinement is repeated here rather than left to the engine so the 400
 * arrives from the organiser's own request with a message about their own
 * chain: a chain ending in extra time describes a bout that can come back level
 * for ever and can therefore never be finished.
 */
const levelStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draw') }).strict(),
  z.object({ kind: z.literal('sudden_death') }).strict(),
  z.object({ kind: z.literal('extra_time'), seconds: z.number().int().min(1).max(3600) }).strict(),
]);
const levelChainSchema = z
  .array(levelStepSchema)
  .min(1)
  .refine((steps) => steps[steps.length - 1]?.kind !== 'extra_time', {
    message: 'the last step must be draw or sudden_death — extra time can end level again',
  });
const levelAtTimeSchema = z
  .object({
    pool: levelChainSchema.optional(),
    bracket: levelChainSchema.optional(),
    finals: levelChainSchema.optional(),
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
    // The schema is `.strict()`, so a key the organiser surface sends and this
    // does not list 400s the whole PATCH. The ceiling has been configurable for
    // a long time; what it DOES only became a choice with the three outcomes.
    maxDoubleHitOutcome: z
      .enum(['double_loss_zero_scores', 'draw_zero_scores', 'result_stands'])
      .optional(),
    scoringDirection: z.enum(['normal', 'reverse_zero_loses']).optional(),
    bestOf: bestOfSchema.optional(),
    levelAtTime: levelAtTimeSchema.optional(),
  })
  .strict();

/**
 * `.strict()`, so every key an organizer surface sends must be listed here or
 * the whole PATCH 400s — the failure mode the Advanced tab hit for months by
 * writing `forfeitPolicy` instead of `tournamentPolicy`.
 */
const tournamentRulesetConfigSchema = z
  .object({
    // `.int()`: the engine has always required one. min(0) rather than min(1)
    // because a win bonus of zero is a real rule, and this spinner offers it.
    winBonus: z.number().int().min(0).max(20).optional(),
    // Named targets, any count. Supersedes targetValues; both are accepted
    // while the editors migrate, and the engine derives one from the other.
    targets: AuthoredTargetsSchema.optional(),
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
    // Nullish (not just optional) so the FE can send null to mean "no weapon",
    // matching the settings/resume clear path and the sibling clearable fields.
    weapon: z.string().nullish(),
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
    // Nullish so selecting "None" clears the weapon (send null); the service's
    // `if (dto.weapon !== undefined)` block maps an empty/null value to null.
    weapon: z.string().nullish(),
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
    /**
     * Highest creation-wizard step completed. Recorded rather than inferred:
     * every JSONB blob the old heuristic read is written by the server itself
     * (ruleset_config at create, the full scoring config on any PATCH), so
     * progress could not be derived from content. Monotonic server-side.
     */
    wizardStep: z.number().int().min(1).max(4).optional(),
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

// Mid-event ruleset re-pin: a deliberate, audited swap of the tournament's
// ruleset AFTER results exist. Distinct from the ordinary PATCH (which is now
// blocked once matches are scored) — this one requires a justification and
// records an append-only audit with the before/after placings.
const repinTournamentRulesetSchema = z
  .object({
    rulesetCode: z.string().min(1).max(50),
    // Optional — normalised server-side; defaults to the ruleset's 1.0.0.
    rulesetVersion: z.string().max(20).optional(),
    // Mandatory justification (the ceremony). Kept short-but-meaningful so the
    // public disclosure and the audit trail always carry a real reason.
    justification: z.string().trim().min(10).max(1000),
  })
  .strict();
export class RepinTournamentRulesetDto extends createZodDto(repinTournamentRulesetSchema) {}
