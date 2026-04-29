import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateMatchDto {
  @ApiProperty()
  @IsUUID()
  phaseId!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsUUID()
  poolId?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsUUID()
  liceId?: string;

  @ApiProperty()
  @IsUUID()
  redRegistrationId!: string;

  @ApiProperty()
  @IsUUID()
  blueRegistrationId!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsISO8601()
  scheduledAt?: string;

  @ApiProperty({ required: false, default: 'TF_v1' })
  @IsOptional() @IsString()
  rulesetCode?: string;

  @ApiProperty({ required: false, default: '1.0.0' })
  @IsOptional() @IsString()
  rulesetVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  matchNumberLabel?: string;
}

export class UpdateMatchStatusDto {
  @ApiProperty({ enum: ['scheduled', 'running', 'paused', 'completed', 'voided'] })
  @IsIn(['scheduled', 'running', 'paused', 'completed', 'voided'])
  status!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsUUID()
  winnerRegistrationId?: string;
}

export class CreateExchangeDto {
  /**
   * Client-generated UUID for idempotency.
   * The server will upsert on this UUID — inserting the same exchange twice
   * is a no-op. This is what makes offline-first sync safe.
   */
  @ApiProperty({ description: 'Client-generated UUID (idempotency key)' })
  @IsUUID()
  clientUuid!: string;

  @ApiProperty({ type: Number })
  @IsInt() @Min(1)
  sequence!: number;

  @ApiProperty({ enum: ['clean', 'afterblow', 'double', 'no_exchange'] })
  @IsIn(['clean', 'afterblow', 'double', 'no_exchange'])
  type!: string;

  @ApiProperty()
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsInt()
  durationSincePrevMs?: number;

  @ApiProperty({ required: false, enum: ['red', 'blue', null] })
  @IsOptional() @IsIn(['red', 'blue'])
  firstStrikerColor?: 'red' | 'blue';

  @ApiProperty({ required: false, enum: [1, 2] })
  @IsOptional() @IsInt() @Min(1) @Max(2)
  firstStrikeValue?: 1 | 2;

  @ApiProperty({ required: false, enum: [1, 2] })
  @IsOptional() @IsInt() @Min(1) @Max(2)
  afterblowValue?: 1 | 2;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  noExchangeReason?: string;
}

export class VoidExchangeDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  reason?: string;
}
