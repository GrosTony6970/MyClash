import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GeneratePoolsDto {
  /**
   * Explicit number of pools. Mutually exclusive with targetSize.
   * If neither provided, defaults to targetSize=8.
   */
  @ApiProperty({ required: false, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  poolCount?: number;

  /**
   * Target fighters per pool (e.g. 8 → ceil(fighters/8) pools).
   * Mutually exclusive with poolCount.
   */
  @ApiProperty({ required: false, example: 8 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(20)
  targetSize?: number;

  /** Enforce school (club) separation across pools (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceSchoolSeparation?: boolean;

  /** Enforce skill balance across pools (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceSkillBalance?: boolean;

  /** PRNG seed for deterministic generation (default: 42) */
  @ApiProperty({ required: false, default: 42 })
  @IsOptional()
  @IsInt()
  seed?: number;

  /** Lice ID to assign matches to (optional — assigns all to one Lice if provided) */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  liceId?: string;
}

export class GenerateBracketDto {
  /**
   * Number of fighters to qualify from pool phase (top N by standings).
   * Defaults to next power of 2 ≤ total pool finishers.
   */
  @ApiProperty({ required: false, example: 16 })
  @IsOptional()
  @IsInt()
  @Min(2)
  qualifyCount?: number;

  /**
   * Explicit bracket size (must be power of 2 and ≥ qualifyCount).
   * Defaults to next power of 2 ≥ qualifyCount.
   */
  @ApiProperty({ required: false, example: 16 })
  @IsOptional()
  @IsInt()
  @Min(2)
  bracketSize?: number;

  /** Phase ID of the pool phase to read standings from */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  poolPhaseId?: string;
}

export class UpdatePhaseVisibilityDto {
  visibility!: 'hidden' | 'published';
  confirmStarted?: boolean;
}

export class UpdateBracketSlotDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  registrationAId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  registrationBId?: string | null;
}
