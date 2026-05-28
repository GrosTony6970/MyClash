import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTOs for the public email + password account flow on app.${DOMAIN}.
 *
 * The backend's existing `passwordLogin` route refuses non-admin users
 * (via `hasAdminAccess`), so these are the parallel routes that the
 * public app sign-in / sign-up / reset forms talk to.
 */

export class PublicSignupDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MaxLength(256)
  password!: string;
}

export class PublicLoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  password!: string;
}

export class PublicPasswordResetDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PublicPasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(2048)
  token!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MaxLength(256)
  password!: string;
}
