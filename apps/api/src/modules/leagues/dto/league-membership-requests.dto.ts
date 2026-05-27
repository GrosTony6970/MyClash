import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLeagueMembershipRequestBodyDto {
  @ApiProperty()
  @IsUUID()
  leagueId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiProperty({ required: false, enum: ['member', 'admin'] })
  @IsOptional()
  @IsIn(['member', 'admin'])
  requestedRole?: 'member' | 'admin';
}

export class ReviewLeagueMembershipRequestBodyDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
