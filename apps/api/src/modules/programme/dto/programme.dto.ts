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
