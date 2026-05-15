import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class PasswordLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  /** Optional redirect path after successful auth (validated server-side). */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  redirectTo?: string;
}
