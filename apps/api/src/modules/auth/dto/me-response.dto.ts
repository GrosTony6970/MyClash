import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_ROLES, type PlatformRole } from '@myclash/types';

/**
 * The `/api/v1/me` body — the one identity payload every surface opens with.
 *
 * ── Why these are CLASSES and not inline object types ───────────────────────
 * They were inline until 2026-08-20, decorated with a bare
 * `@ApiProperty({ required: false })`. Swagger cannot see into an inline type,
 * so the emitted spec carried the four members with NO properties, and the
 * generated client rendered them as `Record<string, never>` — a type that
 * accepts nothing and reads nothing.
 *
 * That is not a cosmetic defect. It is why eleven frontend sites each hand-wrote
 * their own version of this shape: the official one was unusable, so nobody
 * could use it. Two of those hand-written copies shipped real bugs — a staff
 * gate testing for a `type` this DTO never emits, and a self-demotion guard
 * reading `data.id` where the account is at `user.id`, which meant it never
 * fired. A shape that cannot be imported gets guessed, and guesses rot.
 *
 * Keep every member decorated. An undecorated one silently vanishes from the
 * spec and the class stops being the contract it looks like.
 */

export class MeUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ required: false }) display_name?: string;
  /** The claimed user's global profile photo, when a global_persons row is linked. */
  @ApiProperty({ required: false }) photo_url?: string;
}

export class MePersonDto {
  @ApiProperty() id!: string;
  @ApiProperty() given_name!: string;
  @ApiProperty() family_name!: string;
  @ApiProperty() event_id!: string;
  @ApiProperty() claim_status!: string;
}

export class MeOrganizationDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() role!: string;
}

export class MeAdminDto {
  /**
   * The caller's platform tier, or null for an account with no platform role.
   *
   * REPLACED the `isSuperAdmin` boolean rather than joining it: a boolean
   * cannot express three states, and keeping a derived one alongside would
   * guarantee somebody kept reading it and silently treated a platform_admin
   * as an ordinary organiser. Every consumer had to be visited anyway.
   *
   * Note the null case is reachable — an org owner or a personal league admin
   * gets an `admin` block with `platformRole: null`.
   */
  @ApiProperty({ enum: PLATFORM_ROLES, nullable: true })
  platformRole!: PlatformRole | null;

  /**
   * Every org this account is a member of. `name` is here so the sidebar
   * workspace switcher can list them by name — a slug or an id in that menu
   * is not something an operator recognises as their own club.
   */
  @ApiProperty({ type: [MeOrganizationDto] })
  organizations!: MeOrganizationDto[];

  /**
   * True when the user holds a PERSONAL league_user_roles admin/owner grant.
   * Gates the "My leagues" nav entry and the /dashboard league branch.
   *
   * Deliberately NOT "listManageable would return >= 1": org-derived leagues
   * already have a home at /org/{slug}/leagues, and a super-admin manages
   * every league. The /leagues page itself still lists the full union, so the
   * nav gate is intentionally narrower than the page source — change one and
   * you must change the other.
   */
  @ApiProperty({ required: false })
  hasLeagueRoles?: boolean;
}

/** Present only when type='guest' */
export class MeGuestSessionDto {
  @ApiProperty() device_label!: string;
  @ApiProperty() expires_at!: string;
}

export class MeResponseDto {
  @ApiProperty({ enum: ['claimed', 'guest', 'anonymous'] })
  type!: 'claimed' | 'guest' | 'anonymous';

  @ApiProperty({ type: MeUserDto, required: false })
  user?: MeUserDto;

  @ApiProperty({ type: MePersonDto, required: false })
  person?: MePersonDto;

  @ApiProperty({ type: MeAdminDto, required: false })
  admin?: MeAdminDto;

  /** Present only when type='guest' */
  @ApiProperty({ type: MeGuestSessionDto, required: false })
  session?: MeGuestSessionDto;

  /**
   * Documents this account has not accepted at the published version — empty
   * for a guest or an anonymous caller, who have no account to attach one to.
   *
   * Drives the re-acceptance banner. It is a banner and not a wall on purpose:
   * a competitor mid-event must not be locked out of their own schedule because
   * the privacy policy gained a sub-processor.
   */
  @ApiProperty({ required: false, enum: ['terms', 'privacy'], isArray: true })
  pendingLegal?: Array<'terms' | 'privacy'>;
}
