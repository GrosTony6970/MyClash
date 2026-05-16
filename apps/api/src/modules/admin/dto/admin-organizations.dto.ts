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

export class ListOrgsQueryDto {
  @ApiProperty({ required: false, description: 'Filter by status' })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @ApiProperty({ required: false, description: 'Search by name or slug' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    required: false,
    enum: ['name', 'created_at', 'last_activity'],
    default: 'created_at',
  })
  @IsOptional()
  @IsIn(['name', 'created_at', 'last_activity'])
  sortBy?: 'name' | 'created_at' | 'last_activity';

  @ApiProperty({ required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

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
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, digits, and hyphens',
  })
  slug!: string;

  @ApiProperty({ example: 'organizer@example.com' })
  @IsEmail()
  ownerEmail!: string;

  @ApiProperty({ example: 'Jean Dupont', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerDisplayName?: string;
}

export class ReassignOwnerDto {
  @ApiProperty({ description: 'User ID of the new owner (must be an existing member)' })
  @IsUUID()
  newOwnerUserId!: string;
}

export class PromoteSuperAdminDto {
  @ApiProperty({ description: 'User ID to promote to super_admin' })
  @IsUUID()
  userId!: string;
}
