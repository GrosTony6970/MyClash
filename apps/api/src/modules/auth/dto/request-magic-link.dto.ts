import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class RequestMagicLinkDto {
  @ApiProperty({ example: 'jean.dupont@example.com' })
  @IsEmail()
  email!: string;

  /**
   * 'login'  — organizer / claimed-user login (admin app)
   * 'claim'  — participant claiming their Person profile (public app)
   */
  @ApiProperty({ enum: ['login', 'claim'] })
  @IsIn(['login', 'claim'])
  type!: 'login' | 'claim';

  /**
   * Required when type='claim'. The Person ID the participant is claiming.
   * The API verifies that persons.email matches the provided email before
   * sending the link — prevents claiming someone else's profile.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  personId?: string;

  /** Optional redirect path after successful auth (validated server-side). */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  redirectTo?: string;
}
