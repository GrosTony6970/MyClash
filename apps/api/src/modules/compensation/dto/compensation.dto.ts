import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlanDto {
  @ApiProperty({ example: 'Mon plan' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  publicVisibility?: boolean;
}

export class UpdatePlanDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  publicVisibility?: boolean;
}

export class RoleRateEntryDto {
  @ApiProperty({ enum: ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'] })
  @IsIn(['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'])
  refereeRole!: string;

  @ApiProperty({ enum: ['pool', 'bracket', 'finals'] })
  @IsIn(['pool', 'bracket', 'finals'])
  compensationPhase!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  tokensPerMatch!: number;
}

export class UpsertRoleRatesDto {
  @ApiProperty({ type: [RoleRateEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleRateEntryDto)
  rates!: RoleRateEntryDto[];
}

export class TierEntryDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  minTokens!: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxTokens?: number | null;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number;
}

export class UpsertTiersDto {
  @ApiProperty({ type: [TierEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierEntryDto)
  tiers!: TierEntryDto[];
}

export class UpsertEventSettingsDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCompensationAmount?: number | null;
}

export class TogglePaidDto {
  @ApiProperty()
  @IsBoolean()
  paid!: boolean;
}
