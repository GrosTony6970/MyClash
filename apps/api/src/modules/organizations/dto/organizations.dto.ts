import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Lyon AMHE' })
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'lyon-amhe' })
  @IsString() @MinLength(3) @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, digits, and hyphens' })
  slug!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsEmail()
  contactEmail?: string;
}

export class UpdateOrganizationDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsEmail()
  contactEmail?: string;
}

export class AddMemberDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: ['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only'] })
  @IsIn(['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only'])
  role!: string;
}
