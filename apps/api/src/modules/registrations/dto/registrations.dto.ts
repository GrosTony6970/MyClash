import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// Valid status transitions: registered → checked_in → done
// Cannot skip steps.
export const REGISTRATION_STATUS_TRANSITIONS: Record<string, string[]> = {
  registered: ['checked_in'],
  checked_in: ['done', 'withdrawn'],
  done: [],
  withdrawn: [],
  disqualified: [],
};

export class CreateRegistrationDto {
  @ApiProperty()
  @IsUUID()
  personId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  fighterId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  seed?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  bibNumber?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;
}

export class UpdateRegistrationStatusDto {
  @ApiProperty({ enum: ['registered', 'checked_in', 'done', 'withdrawn', 'disqualified'] })
  @IsIn(['registered', 'checked_in', 'done', 'withdrawn', 'disqualified'])
  status!: string;
}
