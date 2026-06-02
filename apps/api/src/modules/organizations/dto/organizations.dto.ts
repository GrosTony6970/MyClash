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
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'lyon-amhe' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, digits, and hyphens' })
  slug!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}

export class UpdateOrganizationDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiProperty({
    required: false,
    description: 'Public URL of the organization logo (set by the upload endpoint).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiProperty({
    required: false,
    description:
      "Organization brand colour as a hex string (e.g. '#c0392b'). " +
      'Rendered as the left-edge accent stripe on each event card on the public landing.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/u, {
    message: 'brandColor must be a 6-digit hex color like #c0392b',
  })
  brandColor?: string | null;
}

export class AddMemberDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({
    enum: ['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only'],
  })
  @IsIn(['admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only'])
  role!: string;
}
