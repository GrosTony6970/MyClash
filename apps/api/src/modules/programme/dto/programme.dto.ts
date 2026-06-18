import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const HH_MM = /^\d{2}:\d{2}$/;

export class SuggestProgrammeDto {
  @IsString()
  @Matches(HH_MM)
  dayStartTime: string = '08:00';

  @IsString()
  @Matches(HH_MM)
  dayEndTime: string = '19:00';

  @IsInt()
  @Min(1)
  parallelLiceCount: number = 1;

  @IsInt()
  @Min(1)
  matchDurationMinutes: number = 5;

  @IsInt()
  @Min(0)
  matchGapSeconds: number = 15;

  @IsInt()
  @Min(0)
  breakBetweenSessionsMinutes: number = 20;

  @IsString()
  @Matches(HH_MM)
  middayBreakStart: string = '12:00';

  @IsString()
  @Matches(HH_MM)
  middayBreakEnd: string = '13:00';

  @IsInt()
  @Min(0)
  registrationDurationMinutes: number = 60;

  @IsInt()
  @Min(0)
  gearCheckDurationMinutes: number = 30;

  @IsInt()
  @Min(0)
  refereeMeetingDurationMinutes: number = 30;
}

export class ProgrammeBlockDto {
  @IsString()
  @IsNotEmpty()
  id: string = '';

  @IsInt()
  @Min(0)
  dayIndex: number = 0;

  @IsInt()
  @Min(0)
  sortOrder: number = 0;

  @IsIn(['admin', 'competition', 'workshop', 'break'])
  blockType: string = 'break';

  @IsString()
  @IsNotEmpty()
  label: string = '';

  @IsOptional()
  @IsUUID()
  competitionId: string | null = null;

  @IsOptional()
  @IsIn(['pool', 'bracket', 'finals'])
  competitionPhase: string | null = null;

  @IsOptional()
  @IsUUID()
  workshopId: string | null = null;

  @IsInt()
  @Min(0)
  liceCount: number = 1;

  @IsString()
  @Matches(HH_MM)
  startTime: string = '08:00';

  @IsString()
  @Matches(HH_MM)
  endTime: string = '09:00';

  @IsInt()
  @Min(0)
  matchGapSeconds: number = 15;

  @IsInt()
  @Min(0)
  matchDurationMinutes: number = 5;
}

export class SaveProgrammeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgrammeBlockDto)
  blocks: ProgrammeBlockDto[] = [];
}

/**
 * Move a single programme block to a new start time on the same day.
 * Cascade-shifts every match scheduled at or after the block's OLD
 * start by the same Δ — keeps the visual ordering of the grid intact
 * when the operator drags a fixed bar.
 */
export class MoveBlockDto {
  @IsString()
  @Matches(HH_MM)
  newStartTime: string = '09:00';
}

/**
 * Resize a block by setting a new end time. The operator drags the
 * block's bottom edge on the schedule grid; the FE rounds to the
 * grid's 5-min slot and PATCHes the new HH:MM. The block's start
 * time stays unchanged — only the duration grows or shrinks.
 */
export class ResizeBlockDto {
  @IsString()
  @Matches(HH_MM)
  newEndTime: string = '10:00';
}

/**
 * Re-fan a group of matches (a pool or a bracket sub-tree) across the given
 * lices from a start time. `mode` 'pool' keeps the group on one lice; 'bracket-
 * branch' applies branch-aware grouping (each quarter-final sub-tree on one
 * lice). The group lands after whatever already occupies those lices.
 */
export class ScheduleGroupDto {
  @IsArray()
  @IsUUID('all', { each: true })
  matchIds: string[] = [];

  @IsArray()
  @IsUUID('all', { each: true })
  liceIds: string[] = [];

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T/)
  startTime: string = '';

  @IsIn(['pool', 'bracket-branch'])
  mode: 'pool' | 'bracket-branch' = 'bracket-branch';

  @IsOptional()
  @IsInt()
  @Min(1)
  matchDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  matchGapSeconds?: number;
}

/** Rename a single programme block (admin / break / workshop bar). */
export class UpdateBlockLabelDto {
  @IsString()
  @IsNotEmpty()
  label: string = '';
}

/**
 * Create ONE programme block (used by the grid's "double-click → add break"
 * affordance and by Undo after a block is deleted). Unlike the bulk save this
 * appends a single row; `sortOrder` is assigned server-side (next on the day).
 * Competition-only fields default to the non-competition zero values.
 */
export class CreateBlockDto {
  @IsInt()
  @Min(0)
  dayIndex: number = 0;

  @IsIn(['admin', 'competition', 'workshop', 'break'])
  blockType: string = 'break';

  @IsString()
  @IsNotEmpty()
  label: string = '';

  @IsString()
  @Matches(HH_MM)
  startTime: string = '08:00';

  @IsString()
  @Matches(HH_MM)
  endTime: string = '09:00';

  @IsOptional()
  @IsInt()
  @Min(0)
  liceCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  matchGapSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  matchDurationMinutes?: number;

  @IsOptional()
  @IsUUID()
  competitionId?: string | null;

  @IsOptional()
  @IsIn(['pool', 'bracket', 'finals'])
  competitionPhase?: string | null;

  @IsOptional()
  @IsUUID()
  workshopId?: string | null;
}
