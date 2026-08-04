import { ApiProperty } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty({ enum: ['claimed', 'guest', 'anonymous'] })
  type!: 'claimed' | 'guest' | 'anonymous';

  @ApiProperty({ required: false })
  user?: {
    id: string;
    email: string;
    display_name?: string;
    /** The claimed user's global profile photo, when a global_persons row is linked. */
    photo_url?: string;
  };

  @ApiProperty({ required: false })
  person?: {
    id: string;
    given_name: string;
    family_name: string;
    event_id: string;
    claim_status: string;
  };

  @ApiProperty({ required: false })
  admin?: {
    isSuperAdmin: boolean;
    organizations: Array<{
      id: string;
      slug: string;
      role: string;
    }>;
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
    hasLeagueRoles?: boolean;
  };

  /** Present only when type='guest' */
  @ApiProperty({ required: false })
  session?: {
    device_label: string;
    expires_at: string;
  };

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
