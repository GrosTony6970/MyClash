import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertFeatureFlagDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class FeatureFlagKeyParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;
}
