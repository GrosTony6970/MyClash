import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListAuditLogQueryDto {
  @ApiProperty({ required: false, description: 'Filter by actor_user_id' })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiProperty({ required: false, description: 'Filter by exact audit action' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({ required: false, description: 'Filter by exact entity_type' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({ required: false, description: 'Inclusive created_at lower bound' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ required: false, description: 'Inclusive created_at upper bound' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsString()
  perPage?: string;
}
