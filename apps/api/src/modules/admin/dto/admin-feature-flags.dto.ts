import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertFeatureFlagDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class FeatureFlagKeyParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;
}
