import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClubDto {
  @ApiProperty({ example: 'Lyon AMHE' })
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(255)
  website?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  logoUrl?: string;
}

export class UpdateClubDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(255)
  website?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  logoUrl?: string;
}

export class ClubQueryDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2)
  country?: string;
}
