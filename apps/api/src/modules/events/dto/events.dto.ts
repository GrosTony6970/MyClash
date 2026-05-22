import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsHexColor,
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
  location?: string;

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
  location?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  endDate?: string;

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
    description: 'AI spend cap in EUR for this event (null = no cap)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  aiSpendCapEur?: number | null;
}

export class UpsertEventThemeDto {
  @ApiProperty({ required: false, example: '#dc2626' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string | null;

  @ApiProperty({ required: false, example: '#0f172a' })
  @IsOptional()
  @IsHexColor()
  secondaryColor?: string | null;

  @ApiProperty({ required: false, example: '#f59e0b' })
  @IsOptional()
  @IsHexColor()
  accentColor?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  heroImageUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fontDisplay?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fontBody?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customCss?: string | null;
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

class ForfeitPolicyDto {
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

class TournamentRulesetConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  winBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  afterblowWindowMs?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TargetValuesDto)
  targetValues?: TargetValuesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ForfeitPolicyDto)
  forfeitPolicy?: ForfeitPolicyDto;
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

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
  @IsString()
  category?: string;

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
}
