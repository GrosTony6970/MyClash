import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// Valid status transitions: registered → checked_in → done.
// Slice 3 of the capacity overhaul: also allow registered → withdrawn
// (operators may pull a no-show before check-in), and waitlist →
// registered (the promote path uses this transition). The 'waitlist'
// status itself is never set via PATCH /:id/status — it lands only via
// addToWaitlist or stays unchanged via the auto/manual promote paths —
// so it isn't a valid destination here.
export const REGISTRATION_STATUS_TRANSITIONS: Record<string, string[]> = {
  registered: ['checked_in', 'withdrawn'],
  checked_in: ['done', 'withdrawn'],
  done: [],
  withdrawn: [],
  disqualified: [],
  waitlist: ['registered'],
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
