import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { LeagueScoringConfig, LeagueTieBreaker } from '../league.types';

export class CreateLeagueDto {
  @ApiProperty({ example: 'French National League 2026' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'french-national-league-2026' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  seasonYear!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerOrganizationId?: string;

  @ApiProperty({ required: false, enum: ['ffamhe_tf_2026', 'custom'] })
  @IsOptional()
  @IsIn(['ffamhe_tf_2026', 'custom'])
  scoringSystem?: 'ffamhe_tf_2026' | 'custom';

  @ApiProperty({ required: false, enum: ['weapon', 'weapon_category'] })
  @IsOptional()
  @IsIn(['weapon', 'weapon_category'])
  rankingDimensions?: 'weapon' | 'weapon_category';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  customPointsByRank?: Record<number, number>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  tieBreakers?: LeagueTieBreaker[];
}

export class UpdateLeagueDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiProperty({ required: false, enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  publicVisibility?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  scoringConfig?: LeagueScoringConfig;
}

export class AddLeagueOrganizationRoleDto {
  @ApiProperty()
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ enum: ['member', 'admin', 'owner'] })
  @IsIn(['member', 'admin', 'owner'])
  role!: 'member' | 'admin' | 'owner';
}

export class AddLeagueUserRoleDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: ['admin', 'owner'] })
  @IsIn(['admin', 'owner'])
  role!: 'admin' | 'owner';
}

export class ReviewLeagueTournamentLinkDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'removed'] })
  @IsIn(['approved', 'rejected', 'removed'])
  status!: 'approved' | 'rejected' | 'removed';
}

export class LeagueStandingsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  group?: string;
}
