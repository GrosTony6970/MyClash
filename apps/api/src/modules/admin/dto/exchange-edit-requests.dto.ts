import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListExchangeEditRequestsDto {
  @ApiProperty({ required: false, enum: ['pending', 'approved', 'rejected', 'all'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status?: 'pending' | 'approved' | 'rejected' | 'all';
}

export class RejectExchangeEditRequestDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
