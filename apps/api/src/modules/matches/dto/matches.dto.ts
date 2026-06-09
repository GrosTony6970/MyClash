import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
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
  @IsOptional()
  @IsUUID()
  poolId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  liceId?: string;

  @ApiProperty()
  @IsUUID()
  redRegistrationId!: string;

  @ApiProperty()
  @IsUUID()
  blueRegistrationId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiProperty({ required: false, default: 'TF_v1' })
  @IsOptional()
  @IsString()
  rulesetCode?: string;

  @ApiProperty({ required: false, default: '1.0.0' })
  @IsOptional()
  @IsString()
  rulesetVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  matchNumberLabel?: string;
}

export class UpdateMatchStatusDto {
  @ApiProperty({ enum: ['scheduled', 'running', 'paused', 'completed', 'voided'] })
  @IsIn(['scheduled', 'running', 'paused', 'completed', 'voided'])
  status!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
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
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiProperty({ enum: ['clean', 'afterblow', 'double', 'no_exchange'] })
  @IsIn(['clean', 'afterblow', 'double', 'no_exchange'])
  type!: string;

  @ApiProperty()
  @IsISO8601()
  occurredAt!: string;

  /**
   * Match-clock position (accumulated active ms) when the exchange was
   * recorded. Persisted to exchanges.clock_time_ms so the timeline can
   * show match-clock time rather than wall-clock. Sent by the scoring
   * pad on every exchange — the field MUST be whitelisted here or the
   * global forbidNonWhitelisted pipe rejects the whole POST with a 400.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  clockTimeMs?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  durationSincePrevMs?: number;

  @ApiProperty({ required: false, enum: ['red', 'blue', null] })
  @IsOptional()
  @IsIn(['red', 'blue'])
  firstStrikerColor?: 'red' | 'blue';

  @ApiProperty({ required: false, description: 'Points for the first strike (≥1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  firstStrikeValue?: number;

  // Deductive afterblow mode awards the defender 0, so this MUST allow 0 —
  // @IsOptional() does NOT skip a present 0, and @Min(1) would 400 the whole
  // POST. The cap is raised to 10 so configurable button point values pass.
  @ApiProperty({ required: false, description: 'Points for the afterblow (0 in deductive mode)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  afterblowValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  noExchangeReason?: string;
}

export class VoidExchangeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class EditExchangeDto {
  @ApiProperty({ enum: ['clean', 'afterblow', 'double', 'no_exchange'] })
  @IsIn(['clean', 'afterblow', 'double', 'no_exchange'])
  type!: string;

  @ApiProperty({ required: false, enum: ['red', 'blue', null] })
  @IsOptional()
  @IsIn(['red', 'blue'])
  firstStrikerColor?: 'red' | 'blue';

  @ApiProperty({ required: false, description: 'Points for the first strike (≥1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  firstStrikeValue?: number;

  // Deductive afterblow mode awards the defender 0, so this MUST allow 0 —
  // @IsOptional() does NOT skip a present 0, and @Min(1) would 400 the whole
  // POST. The cap is raised to 10 so configurable button point values pass.
  @ApiProperty({ required: false, description: 'Points for the afterblow (0 in deductive mode)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  afterblowValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  noExchangeReason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ResetMatchDto {
  @ApiProperty({ example: 'RESET MATCH' })
  @IsString()
  confirmation!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateMatchForfeitDto {
  @ApiProperty()
  @IsUUID()
  forfeitingRegistrationId!: string;

  @ApiProperty({
    enum: ['injury', 'voluntary', 'black_card_1', 'black_card_2', 'conduct_violation'],
  })
  @IsIn(['injury', 'voluntary', 'black_card_1', 'black_card_2', 'conduct_violation'])
  reason!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  canContinue?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class AdjustClockDto {
  @ApiProperty({ description: 'Signed time adjustment in milliseconds' })
  @IsInt()
  adjustmentMs!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class LockMatchDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateMatchDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  liceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  refereeId?: string | null;
}
