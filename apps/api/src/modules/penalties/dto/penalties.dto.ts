import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export type BlackCardForfeitScopeDto = 'match' | 'tournament' | 'none';
const FORFEIT_SCOPE_VALUES: BlackCardForfeitScopeDto[] = ['match', 'tournament', 'none'];

export class CreatePenaltyDto {
  @ApiProperty()
  @IsUUID()
  clientUuid!: string;

  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiProperty()
  @IsUUID()
  registrationId!: string;

  @ApiProperty({ required: false })
  @ValidateIf((dto: CreatePenaltyDto) => !dto.directCard)
  @IsUUID()
  rulesetEntryId?: string;

  @ApiProperty({ required: false, enum: ['yellow', 'red', 'black'] })
  @ValidateIf((dto: CreatePenaltyDto) => !dto.rulesetEntryId)
  @IsIn(['yellow', 'red', 'black'])
  directCard?: 'yellow' | 'red' | 'black';

  @ApiProperty()
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ required: false })
  @ValidateIf((dto: CreatePenaltyDto) => Boolean(dto.directCard))
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class VoidPenaltyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreatePenaltyRulesetDto {
  @ApiProperty()
  @IsUUID()
  ownerOrganizationId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  code!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  version!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['match', 'phase', 'tournament'], default: 'match' })
  @IsIn(['match', 'phase', 'tournament'])
  accumulationScope!: 'match' | 'phase' | 'tournament';

  @ApiProperty({ default: false })
  @IsBoolean()
  publicVisibility!: boolean;

  @ApiProperty({ type: Array })
  @IsArray()
  entries!: Array<{
    groupNumber: number;
    refNumber: number;
    shortName: string;
    description: string;
    sanctions: Array<'yellow' | 'red' | 'black'>;
  }>;

  @ApiProperty({ required: false, description: 'Score delta applied per yellow card (default 0)' })
  @IsOptional()
  @IsNumber()
  yellowCardPoints?: number;

  @ApiProperty({ required: false, description: 'Score delta applied per red card (default -1)' })
  @IsOptional()
  @IsNumber()
  redCardPoints?: number;

  @ApiProperty({ required: false, description: 'Score delta applied per black card (default 0)' })
  @IsOptional()
  @IsNumber()
  blackCardPoints?: number;

  @ApiProperty({
    required: false,
    enum: FORFEIT_SCOPE_VALUES,
    description: "Scope of the forfeit triggered by the registration's first black card.",
  })
  @IsOptional()
  @IsIn(FORFEIT_SCOPE_VALUES)
  firstBlackCardForfeit?: BlackCardForfeitScopeDto;

  @ApiProperty({
    required: false,
    enum: FORFEIT_SCOPE_VALUES,
    description: 'Scope of the forfeit triggered by a second (or later) black card.',
  })
  @IsOptional()
  @IsIn(FORFEIT_SCOPE_VALUES)
  secondBlackCardForfeit?: BlackCardForfeitScopeDto;
}

export class ImportPenaltyRulesetCsvDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerOrganizationId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiProperty()
  @IsString()
  version!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: ['match', 'phase', 'tournament'], default: 'match' })
  @IsIn(['match', 'phase', 'tournament'])
  accumulationScope!: 'match' | 'phase' | 'tournament';

  @ApiProperty()
  @IsString()
  csv!: string;
}

export class UpdatePenaltyRulesetDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, enum: ['match', 'phase', 'tournament'] })
  @IsOptional()
  @IsIn(['match', 'phase', 'tournament'])
  accumulationScope?: 'match' | 'phase' | 'tournament';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  publicVisibility?: boolean;

  /**
   * Full replacement set of entries. When provided, the service deletes any
   * existing entries for this ruleset and inserts these. Omit to leave
   * entries untouched.
   */
  @ApiProperty({ required: false, type: Array })
  @IsOptional()
  @IsArray()
  entries?: Array<{
    groupNumber: number;
    refNumber: number;
    shortName: string;
    description: string;
    sanctions: Array<'yellow' | 'red' | 'black'>;
  }>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  yellowCardPoints?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  redCardPoints?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  blackCardPoints?: number;

  @ApiProperty({ required: false, enum: FORFEIT_SCOPE_VALUES })
  @IsOptional()
  @IsIn(FORFEIT_SCOPE_VALUES)
  firstBlackCardForfeit?: BlackCardForfeitScopeDto;

  @ApiProperty({ required: false, enum: FORFEIT_SCOPE_VALUES })
  @IsOptional()
  @IsIn(FORFEIT_SCOPE_VALUES)
  secondBlackCardForfeit?: BlackCardForfeitScopeDto;
}

/**
 * R3: payload for super-admin rejection of a penalty-ruleset sharing
 * request. The reason is shown to the organizer so they can fix the
 * issue and resubmit.
 */
export class RejectPenaltyRulesetSharingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class AssignPenaltyRulesetDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  penaltyRulesetId?: string | null;
}

export class ReviewPenaltyDto {
  @ApiProperty({ enum: ['confirmed', 'dismissed'] })
  @IsIn(['confirmed', 'dismissed'])
  status!: 'confirmed' | 'dismissed';
}
