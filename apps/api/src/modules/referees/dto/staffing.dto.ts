import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A single staffing slot inside a phase-type's config.
 *
 * `index` is dense (1..6) within a phase_type — the service writes
 * sequential slot_index values; reading rebuilds the dense list.
 * `allowedSkillIds` MUST contain at least one referee_skills.id.
 */
export class StaffingSlotDto {
  @ApiProperty({ minimum: 1, maximum: 6 })
  @IsInt()
  @Min(1)
  @Max(6)
  index!: number;

  @ApiProperty({ required: false, nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @ApiProperty({ type: 'array', items: { type: 'string' }, minItems: 1 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowedSkillIds!: string[];
}

/**
 * Whole-config payload for a (tournament|event) PUT. The three
 * phase-type arrays are independent and can each carry 1..6 slots.
 */
export class StaffingConfigPayloadDto {
  @ApiProperty({ type: [StaffingSlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StaffingSlotDto)
  pool!: StaffingSlotDto[];

  @ApiProperty({ type: [StaffingSlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StaffingSlotDto)
  bracket!: StaffingSlotDto[];

  @ApiProperty({ type: [StaffingSlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StaffingSlotDto)
  finals!: StaffingSlotDto[];

  /**
   * When true, the caller has reviewed the affected-assignment list and
   * accepts that those `referee_assignments` rows will be deleted as
   * part of this write. When false (default), the service throws
   * ConflictException listing the affected assignments instead.
   */
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  confirmDestructive?: boolean;
}
