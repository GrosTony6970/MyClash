import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePersonDto {
  @ApiProperty({ example: 'Jean' })
  @IsString() @MinLength(1) @MaxLength(100)
  givenName!: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString() @MinLength(1) @MaxLength(100)
  familyName!: string;

  @ApiProperty({ example: 'jean.dupont@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  genderCategory?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdatePersonDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  givenName?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  familyName?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  genderCategory?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
