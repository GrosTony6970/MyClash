import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @ApiProperty({ example: 'FAL 2026' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'fal-2026' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, digits, and hyphens' })
  slug!: string;

  @ApiProperty({ example: '2026-03-14' })
  @IsString()
  startDate!: string;

  @ApiProperty({ example: '2026-03-15' })
  @IsString()
  endDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string;

  @ApiProperty({ required: false, example: 'FR', description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  publicLandingMd?: string;
}

export class UpdateEventDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string;

  @ApiProperty({ required: false, example: 'FR', description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ required: false, example: 'Europe/Paris', description: 'IANA timezone' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  publicLandingMd?: string;

  @ApiProperty({
    required: false,
    enum: ['draft', 'published', 'running', 'completed', 'archived'],
  })
  @IsOptional()
  @IsIn(['draft', 'published', 'running', 'completed', 'archived'])
  status?: string;

  @ApiProperty({
    required: false,
    description: 'Public URL of the event logo (set by the upload endpoint).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiProperty({
    required: false,
    description: 'AI spend cap in EUR for this event (null = no cap)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  aiSpendCapEur?: number | null;
}

export class UpsertEventThemeDto {
  // logoUrl + heroImageUrl are the only per-event identity affordances
  // that remain. Per-event color overrides + font pickers + custom CSS
  // were retired in migration 0086 — the unified MyClash design is now
  // governed by @myclash/design-tokens across both apps.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  heroImageUrl?: string | null;
}

export class EventQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  /**
   * Hard cap on rows returned. Defaults to 100 (also the max). Spectators
   * poll this endpoint every ~30 s; without a cap the per-poll payload
   * grew linearly with deploy size.
   */
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * Pagination cursor — an ISO date string. The next page returns events
   * whose start_date is strictly less than the cursor. Pair with the
   * default `order by start_date desc` so the cursor walks backward in
   * time deterministically.
   */
  @ApiProperty({ required: false, example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class EventClubQueryDto {
  @ApiProperty({ required: false, enum: ['all', 'event'] })
  @IsOptional()
  @IsIn(['all', 'event'])
  scope?: 'all' | 'event';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class SubmitEventClubRequestDto {
  @ApiProperty({ example: 'Lyon AMHE' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false, example: 'LAMHE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  abbreviation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

class TargetValuesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  deepTarget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  shallowTarget?: number;
}

/**
 * Tournament-level policy switches set by the wizard's Step 4.
 *
 * Renamed from `ForfeitPolicyDto` / `forfeitPolicy` because that name
 * collided with the rulesets-engine `forfeitPolicy.reasons.*` blob
 * (per-reason scoring data) — same JSON key, totally different shape.
 * The collision tripped a 400 on the wizard's final PATCH whenever the
 * persisted row carried the engine shape. Migration 0062 moves any
 * legacy wizard-shape rows from `forfeitPolicy` to `tournamentPolicy`.
 */
class TournamentPolicyDto {
  @IsOptional()
  @IsBoolean()
  forfeitDrawsCount?: boolean;

  @IsOptional()
  @IsBoolean()
  forfeitFighterBefore1stMatch?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  disqualifyAfter?: number;
}

class TimeLimitsSecondsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3600)
  pool?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3600)
  bracket?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3600)
  finals?: number | null;
}

/**
 * Match-format payload sent by the tournament creation wizard (Step 2)
 * and the per-tournament settings page. Persisted under
 * `tournaments.ruleset_config.matchFormat`. Field bounds mirror the
 * input clamps in `Step2MatchFormat.tsx`.
 */
class MatchFormatDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  pointCap?: number;

  @IsOptional()
  @IsIn(['countdown', 'countup'])
  timerMode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TimeLimitsSecondsDto)
  timeLimitsSeconds?: TimeLimitsSecondsDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  softClockLimitSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  maxDoubleHits?: number | null;

  @IsOptional()
  @IsIn(['normal', 'reverse_zero_loses'])
  scoringDirection?: string;
}

class TournamentRulesetConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  winBonus?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TargetValuesDto)
  targetValues?: TargetValuesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentPolicyDto)
  tournamentPolicy?: TournamentPolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatchFormatDto)
  matchFormat?: MatchFormatDto;
}

class TournamentLockConfigDto {
  @IsOptional()
  @IsBoolean()
  autoLockEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1440)
  autoLockDelayMinutes?: number;

  @IsOptional()
  @IsBoolean()
  autoLockCompletedPools?: boolean;

  @IsOptional()
  @IsBoolean()
  autoLockCompletedBrackets?: boolean;
}

export class CreateTournamentDto {
  @ApiProperty({ example: 'Longsword Open' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'longsword-open' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, digits, and hyphens' })
  slug!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  weapon?: string;

  @ApiProperty({ required: false, default: 'TF_v1' })
  @IsOptional()
  @IsString()
  rulesetCode?: string;

  @ApiProperty({ required: false, default: '1' })
  @IsOptional()
  @IsString()
  rulesetVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentRulesetConfigDto)
  rulesetConfig?: TournamentRulesetConfigDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentLockConfigDto)
  lockConfig?: TournamentLockConfigDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  scoringConfig?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  penaltyRulesetId?: string;

  @ApiProperty({
    required: false,
    description:
      'Tournament identity color token (e.g. "red", "amber"). Rendered as a small bubble next to the tournament name across the admin UI.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  /**
   * Capacity caps — surfaced in the create wizard alongside the
   * other Step 1 basics. Null (or omitted) = no cap, matching the
   * settings page semantics on UpdateTournamentDto.
   */
  @ApiProperty({ required: false, nullable: true, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxParticipants?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWaitlist?: number | null;
}

export class UpdateTournamentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  weapon?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['draft', 'published', 'running', 'completed', 'archived'])
  status?: string;

  @ApiProperty({
    required: false,
    description: 'Tournament scoring configuration (afterblow mode + button config)',
  })
  @IsOptional()
  @IsObject()
  scoringConfig?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description: 'Tournament ruleset configuration, including shared match format settings',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentRulesetConfigDto)
  rulesetConfig?: TournamentRulesetConfigDto;

  @ApiProperty({
    required: false,
    description: 'Tournament match lock and auto-lock configuration',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentLockConfigDto)
  lockConfig?: TournamentLockConfigDto;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  penaltyRulesetId?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Public URL of the tournament logo. Pass null to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  rulesetCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rulesetVersion?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Tournament identity color token (e.g. "red", "amber"). Pass null to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  /**
   * Slice 4 of the capacity overhaul: max number of registered + checked-in
   * fighters. Null = no cap (current behaviour). When set, the registrations
   * create endpoint returns 409 reason='tournament_full' once the count
   * meets this value.
   */
  @ApiProperty({ required: false, nullable: true, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxParticipants?: number | null;

  /** Slice 4: max waitlist size. Null = no cap. */
  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWaitlist?: number | null;
}
