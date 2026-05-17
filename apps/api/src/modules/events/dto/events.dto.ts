import { ApiProperty } from '@nestjs/swagger';
import {
  IsHexColor,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { TournamentLockConfig, TournamentScoringConfig } from '@myclash/types';

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
  scoringConfig?: TournamentScoringConfig;

  @ApiProperty({
    required: false,
    description: 'Tournament ruleset configuration, including shared match format settings',
  })
  @IsOptional()
  @IsObject()
  rulesetConfig?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description: 'Tournament match lock and auto-lock configuration',
  })
  @IsOptional()
  @IsObject()
  lockConfig?: TournamentLockConfig;
}
