import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_ROLES, type PlatformRole } from '@myclash/types';
import type { OrgRole } from './admin-users.dto';

/**
 * Response shapes for the platform-accounts console.
 *
 * `@ApiProperty` classes rather than zod: these mirror GoTrue's own row shape,
 * which we do not validate on the way out — the API is the one producing it.
 * Their real job is to give the list endpoints a documented 200 body, which
 * they previously did not have: with no `@ApiOkResponse` the generated client
 * emitted `content?: never`, so nothing downstream could be typed against it.
 */

export class PlatformUserOrgMembershipDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() role!: OrgRole;
}

export class ListedPlatformUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ required: false }) email?: string;
  @ApiProperty({ required: false, type: Object }) user_metadata?: Record<string, unknown>;
  @ApiProperty({ required: false, type: Object }) app_metadata?: Record<string, unknown>;
  @ApiProperty({ required: false }) created_at?: string;
  @ApiProperty({ required: false, nullable: true }) last_sign_in_at?: string | null;
  @ApiProperty({ required: false, nullable: true }) banned_until?: string | null;
  @ApiProperty({ required: false, nullable: true }) email_confirmed_at?: string | null;
  @ApiProperty({ required: false, nullable: true }) updated_at?: string | null;

  /**
   * Derived, never raw: GoTrue stores whatever the identity provider sent, so
   * a Google self-signup has `full_name` and an admin-created account has
   * `display_name`. Null when neither is present.
   */
  @ApiProperty({ nullable: true }) display_name!: string | null;

  @ApiProperty({ type: [PlatformUserOrgMembershipDto] })
  organizations!: PlatformUserOrgMembershipDto[];

  /**
   * Replaces the old `is_super_admin` boolean. Null means "no platform role",
   * which is the common case on the user and organiser tabs.
   */
  @ApiProperty({ enum: PLATFORM_ROLES, nullable: true })
  platform_role!: PlatformRole | null;
}

export class ListPlatformUsersResponseDto {
  @ApiProperty({ type: [ListedPlatformUserDto] }) users!: ListedPlatformUserDto[];

  /**
   * Matches for THIS scope, before paging. Scopes are predicates rather than a
   * partition, so the three totals overlap and do not sum to the number of
   * accounts.
   */
  @ApiProperty() total!: number;

  @ApiProperty() page!: number;
  @ApiProperty() perPage!: number;

  /**
   * True when the GoTrue enumeration hit its page ceiling and the result is
   * incomplete.
   *
   * There is no `auth.users` mirror in `public`, so PostgREST cannot see the
   * account table and every scope filter is an in-app merge over enumerated
   * pages. Past roughly ten thousand accounts that enumeration stops early.
   * It used to stop SILENTLY; now it says so, and the console can too. The
   * real fix is a `public.user_directory` mirror fed from GoTrue, which would
   * turn all of this into one indexed query — a separate slice.
   */
  @ApiProperty({ required: false }) truncated?: boolean;
}

export class GetPlatformUserResponseDto {
  @ApiProperty({ type: ListedPlatformUserDto }) user!: ListedPlatformUserDto;
}
