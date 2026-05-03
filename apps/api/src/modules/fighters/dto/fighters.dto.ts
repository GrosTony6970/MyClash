import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateFighterDto {
  @ApiProperty({ example: 'Jean' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName!: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName!: string;

  @ApiProperty({ example: 'Jean Dupont' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  genderCategory?: string;
}

export class UpdateFighterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
}

export class FighterQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  club?: string;
}

export class PromoteFighterDto {
  @ApiProperty({ description: 'Person ID to promote to global Fighter' })
  @IsUUID()
  personId!: string;
}

export class MergeFightersDto {
  @ApiProperty({ description: 'Source fighter ID (will be merged into target)' })
  @IsUUID()
  sourceId!: string;

  @ApiProperty({ description: 'Target fighter ID (kept after merge)' })
  @IsUUID()
  targetId!: string;

  @ApiProperty({ required: false, description: 'Reason shown in the merge audit log' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
