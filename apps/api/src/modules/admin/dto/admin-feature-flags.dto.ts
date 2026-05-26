import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Narrow payload — only `maintenance_banner` opts in today, so the
 * shape is captured directly here rather than as an open `Record`.
 * Other flag keys reject any payload.
 */
export class MaintenanceBannerPayloadDto {
  @ApiProperty()
  @IsString()
  message!: string;

  @ApiProperty({ enum: ['info', 'warning', 'critical'] })
  @IsString()
  @IsIn(['info', 'warning', 'critical'])
  severity!: 'info' | 'warning' | 'critical';
}

export class UpsertFeatureFlagDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  /**
   * Structured config attached to flags that declare `payload` in the
   * registry (today only `maintenance_banner`). Sent as a plain object
   * to keep the contract simple; the service validates the shape
   * against the registry entry before persisting.
   */
  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  payloadJson?: Record<string, unknown> | null;
}

export class FeatureFlagKeyParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;
}
