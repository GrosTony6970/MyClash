import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

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

  /** Prevent a referee from being scheduled back-to-back across pools (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceRefereeNoBackToBack?: boolean;

  /** Number of pool slots a referee must rest between officiating duties (default: 1) */
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  refereeRestMinSlots?: number;

  /** Ensure competing referees get a rest between the pool they ref and the pool they fight in (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceDedicatedRefereeRest?: boolean;

  /** Never schedule a fighter to referee the same pool they're fighting in (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceFighterRefereeNoOverlap?: boolean;

  /** Prefer referees with higher ratings when multiple candidates are available (default: true) */
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  preferHighRatedReferees?: boolean;
}

export class GenerateBracketDto {
  /**
   * Bracket format. `single_elim` (default) generates a single-elimination
   * tree; `double_elim` adds a losers bracket plus optional grand-final
   * reset. The phases.service consumes this to pick the right scheduler.
   */
  @ApiProperty({ required: false, enum: ['single_elim', 'double_elim'], default: 'single_elim' })
  @IsOptional()
  @IsIn(['single_elim', 'double_elim'])
  phaseType?: 'single_elim' | 'double_elim';

  /**
   * Double-elim only: if true and the lower-bracket finalist beats the
   * upper-bracket finalist in the grand final, run a "reset" match to
   * decide the title. Ignored when phaseType is single_elim.
   */
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  grandFinalReset?: boolean;

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
   * Explicit bracket size (must be power of 2, ≥ qualifyCount, and ≤ 128).
   */
  @ApiProperty({ required: false, example: 16 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(128)
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
