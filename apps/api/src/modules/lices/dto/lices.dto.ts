import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLiceDto {
  @ApiProperty({ example: 'Lice 1' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string;

  @ApiProperty({ required: false, example: '#c0392b' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorHex must be a valid hex color (#rrggbb)' })
  colorHex?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    required: false,
    description: "Venue (org-level) the lice lives inside. Must belong to the event's org.",
  })
  @IsOptional()
  @IsUUID()
  venueId?: string;
}

export class UpdateLiceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorHex must be a valid hex color (#rrggbb)' })
  colorHex?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Venue (org-level) the lice lives inside, or null to detach.',
  })
  @IsOptional()
  @IsUUID()
  venueId?: string | null;
}
