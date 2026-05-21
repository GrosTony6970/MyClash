import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateClubDto {
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

export class UpdateClubDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

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

export class ClubQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiProperty({ required: false, description: 'If true, also search abbreviation field' })
  @IsOptional()
  searchAbv?: boolean;

  @ApiProperty({ required: false, description: 'If true, include archived clubs' })
  @IsOptional()
  includeArchived?: boolean;
}

export class ClubReviewRequestQueryDto {
  @ApiProperty({ required: false, enum: ['pending', 'approved', 'linked', 'rejected', 'all'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'linked', 'rejected', 'all'])
  status?: 'pending' | 'approved' | 'linked' | 'rejected' | 'all';
}

export class LinkClubReviewRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  existingClubId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectClubReviewRequestDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Body shape for the four bulk admin endpoints
 * (`POST /clubs/bulk-verify | bulk-unverify | bulk-archive | bulk-delete`).
 * Max 200 ids per call to keep the sequential fan-out bounded.
 */
export class BulkClubIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}

/**
 * Body shape for `POST /clubs/bulk-update`. Only fields that make sense to
 * apply across many clubs are exposed: `city`, `countryCode`, and
 * `unverified`. All three are optional but at least one must be present —
 * the service rejects with `BadRequestException('No fields to update')`
 * otherwise. The boolean `unverified` is translated to the legacy text
 * column inside the service.
 */
export class BulkClubUpdateDto extends BulkClubIdsDto {
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

  /**
   * When true, marks the selected clubs as unverified. When false, marks
   * them verified AND clears archived_at (matches the single-club verify
   * path that re-activates archived clubs on verify). Omit to leave the
   * status untouched.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  unverified?: boolean;
}
