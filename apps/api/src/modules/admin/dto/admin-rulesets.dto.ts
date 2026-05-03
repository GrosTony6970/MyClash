import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ListRulesetsQueryDto {
  @ApiProperty({ required: false, enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';
}

export class RejectRulesetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
