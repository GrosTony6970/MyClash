import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Reserved slugs that cannot be used as organization slugs. */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'www',
  'myclash',
  'super',
  'staff',
  'support',
  'help',
  'about',
  'blog',
  'docs',
  'status',
  'legal',
  'privacy',
  'terms',
] as const;

export class SignupDto {
  // ── Step 1: Account ──────────────────────────────────────────────────────

  @ApiProperty({ example: 'jean.dupont@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Jean Dupont' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  /**
   * 'magic_link' — send a magic link; account is implicitly verified on click.
   * 'password'   — create with password; email verification required before
   *                creating events.
   */
  @ApiProperty({ enum: ['magic_link', 'password'] })
  @IsIn(['magic_link', 'password'])
  method!: 'magic_link' | 'password';

  /** Required when method='password'. */
  @ApiProperty({ required: false })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  // ── Step 2: Organization ─────────────────────────────────────────────────

  @ApiProperty({ example: 'Lyon AMHE' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  orgName!: string;

  /**
   * URL-safe slug for the organization. Auto-suggested from orgName on the
   * frontend, editable by the user. Must be unique and not reserved.
   * Pattern: lowercase letters, digits, hyphens only. 3–50 chars.
   */
  @ApiProperty({ example: 'lyon-amhe' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, digits, and hyphens',
  })
  orgSlug!: string;
}

export class CheckSlugDto {
  @ApiProperty({ example: 'lyon-amhe' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, digits, and hyphens',
  })
  slug!: string;
}
