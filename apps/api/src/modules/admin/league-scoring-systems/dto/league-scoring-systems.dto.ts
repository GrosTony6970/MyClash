import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLeagueScoringSystemDto {
  @ApiProperty({
    description: 'Stable code stored on `leagues.scoring_system`. Lowercase, digits, underscores.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9_]+$/)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Rank → points map, e.g. { "1": 16, "2": 13, ... }.' })
  @IsObject()
  pointsByRank!: Record<string, number>;

  @ApiProperty({
    required: false,
    description:
      'Ordered tie-breaker dimensions. Allowed: total_points, participation_count, ' +
      'medal_count, double_hit_average. Defaults to the canonical FFAMHE order.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  tieBreakers?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

export class UpdateLeagueScoringSystemDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  pointsByRank?: Record<string, number>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  tieBreakers?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}
