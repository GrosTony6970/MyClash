import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCustomRulesetDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @ApiProperty({ description: 'Score formula AST (FormulaNode tree)' })
  @IsObject()
  scoreFormula!: Record<string, unknown>;

  @ApiProperty({
    description:
      'Per-ruleset numeric constants: pointsPerVictory, pointsPerTie, pointsPerLoss, doublePenalty.',
  })
  @IsObject()
  constants!: Record<string, number>;

  @ApiProperty({ description: 'Ordered list of tiebreakers ({ variable, direction }).' })
  @IsArray()
  tiebreakers!: Array<{ variable: string; direction: 'asc' | 'desc' }>;

  @ApiProperty({
    required: false,
    description: 'MatchFormatConfig used as the default for tournaments created with this ruleset.',
  })
  @IsOptional()
  @IsObject()
  matchFormatDefaults?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description:
      'Free-string expression in terms of `n` (double-hit count). Validated server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doublePenaltyFormula?: string;
}

export class UpdateCustomRulesetDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  scoreFormula?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  constants?: Record<string, number>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  tiebreakers?: Array<{ variable: string; direction: 'asc' | 'desc' }>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  matchFormatDefaults?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doublePenaltyFormula?: string;

  @ApiProperty({
    required: false,
    description:
      "Super-admin overrides for TF v1's TFv1ConfigSchema-shaped defaults " +
      '(winBonus, targetValues, matchFormat, doublePenaltyFormula, forfeitPolicy). ' +
      'Merged over the static TFv1DefaultConfig by resolveRulesetConfigDefaults.',
  })
  @IsOptional()
  @IsObject()
  tfConfig?: Record<string, unknown>;
}

export class CustomRulesetStatusDto {
  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  @IsIn(['draft', 'published', 'archived'])
  status!: 'draft' | 'published' | 'archived';
}

export class SetDefaultDto {
  @ApiProperty()
  @IsBoolean()
  isDefault!: boolean;
}

export class PublishRulesetDto {
  @ApiProperty({
    required: false,
    description:
      'Optional explicit version string for the new draft after publish. ' +
      'When omitted the server auto-bumps the patch component (1.0.0 -> 1.0.1).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nextVersion?: string;
}

export class RejectSubmissionDto {
  @ApiProperty({
    description: 'Reason shown to the organizer so they know what to fix before resubmitting.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason!: string;
}
