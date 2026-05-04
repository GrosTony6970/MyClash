import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class OAuthSessionDto {
  @ApiProperty()
  @IsString()
  accessToken!: string;

  @ApiProperty()
  @IsString()
  refreshToken!: string;

  @ApiProperty({ enum: ['admin_login', 'organizer_signup', 'person_claim'] })
  @IsIn(['admin_login', 'organizer_signup', 'person_claim'])
  mode!: 'admin_login' | 'organizer_signup' | 'person_claim';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  personId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orgName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orgSlug?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  next?: string;
}
