import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SIGNUPS_DISABLED_CODE } from '@myclash/types';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { assertNotReadOnly } from '../../common/read-only-mode';
import { MailService } from '../mail/mail.service';
import { mailedLink } from '../mail/mailed-link';
// Value import, not `import type`: Nest reads design:paramtypes to inject it.
import {
  LegalAcceptanceService,
  type AcceptedLegalVersions,
} from '../privacy/legal-acceptance.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RESERVED_SLUGS, type SignupDto } from './dto/signup.dto';
import { ownedClubSlug, type SignupClub } from './signup-club';

/** The sign-up form's answer: the mail is sent; the club is made once the link is used. */
export interface SignupResult {
  message: string;
  orgSlug: string;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly legal: LegalAcceptanceService,
  ) {}

  // ── Slug availability check ─────────────────────────────────────────────

  async checkSlugAvailability(slug: string): Promise<{
    available: boolean;
    reason?: 'reserved' | 'taken';
  }> {
    const normalized = slug.toLowerCase().trim();

    if ((RESERVED_SLUGS as readonly string[]).includes(normalized)) {
      return { available: false, reason: 'reserved' };
    }

    // Check DB — gracefully handle missing table (pre-T-101)
    try {
      const { data } = await this.supabase.service
        .from('organizations')
        .select('id')
        .eq('slug', normalized)
        .maybeSingle();

      if (data) {
        return { available: false, reason: 'taken' };
      }
    } catch {
      // Table not yet created — treat as available
    }

    return { available: true };
  }

  // ── The "sign-ups off" switch ────────────────────────────────────────────

  /**
   * The ONE read of the super admin's "sign-ups off" switch, asked by every
   * door that makes an organizer account: the form, the mailed link's door
   * and the Google sign-up (operator ruling 305). Only the form read it.
   *
   * The marker class keeps the `code` through the error filter, so a screen
   * tells this 503 from a fault.
   *
   * Read-only mode closes the same three doors, with its own refusal (operator
   * ruling 341): each of them wrote an account and a club while it was on.
   */
  async assertSignupsOpen(): Promise<void> {
    if (await isFlagEnabledDirect(this.supabase, 'disable_signups')) {
      throw new OperationalUnavailableException({
        code: SIGNUPS_DISABLED_CODE,
        message: 'Signups are temporarily disabled',
      });
    }
    await assertNotReadOnly(this.supabase);
  }

  // ── Signup ───────────────────────────────────────────────────────────────

  async signup(dto: SignupDto): Promise<SignupResult> {
    const { email, displayName, orgName, orgSlug } = dto;
    const normalizedSlug = orgSlug.toLowerCase().trim();

    // 0. Agreement, before anything is created or any email leaves the box. A
    //    client running a bundle from before a policy revision is turned away
    //    here rather than after it has an account it was not told about.
    const versions = this.legal.assertCurrent({
      terms: dto.acceptedTerms,
      privacy: dto.acceptedPrivacy,
    });

    // 1. Validate slug
    const slugCheck = await this.checkSlugAvailability(normalizedSlug);
    if (!slugCheck.available) {
      throw new ConflictException(
        slugCheck.reason === 'reserved'
          ? `"${normalizedSlug}" is a reserved slug and cannot be used`
          : `The slug "${normalizedSlug}" is already taken`,
      );
    }

    return this.mailChoosePasswordLink(email, displayName, orgName, normalizedSlug, versions);
  }

  // ── The mailed link ──────────────────────────────────────────────────────

  /**
   * Mail the link that opens the organiser's "choose your password" page (ruling
   * "Pre-takeover"): no password is stored before the address is proven. The page
   * sends the code, the password and the club the link carries to
   * `POST /auth/signup-choose-password`, which makes the club for the account the
   * code names. Until then nothing exists but an account with no password.
   *
   * The accepted versions ride along: no club exists to attach them to until the
   * link is used. They were checked against the registry above, and the record
   * stays faithful to what she ticked even if the policy is revised meanwhile.
   * Her name rides on the account (`options.data`).
   */
  private async mailChoosePasswordLink(
    email: string,
    displayName: string,
    orgName: string,
    orgSlug: string,
    versions: AcceptedLegalVersions,
  ): Promise<SignupResult> {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const club = new URLSearchParams({
      orgName,
      orgSlug,
      acceptedTerms: versions.terms,
      acceptedPrivacy: versions.privacy,
    });
    const page = `https://admin.${domain}/auth/choose-password?${club.toString()}`;

    const { data, error } = await this.supabase.service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { data: { display_name: displayName } },
    });
    // Our page with GoTrue's code, never GoTrue's own link (ruling 303).
    const magicLink = mailedLink(page, data.properties);

    if (error || !magicLink) {
      this.logger.error(`Failed to generate signup magic link for ${email}: ${error?.message}`);
      throw new BadRequestException('Failed to send signup link. Please try again.');
    }

    await this.mail.sendMagicLink({ to: email, magicLink, type: 'confirm', displayName });

    this.logger.log(`Signup link sent to ${email} for org ${orgSlug}`);

    return { message: 'Check your email for a signup link.', orgSlug };
  }

  // ── The club, once the account is proven ────────────────────────────────

  /**
   * Called by the choose-password door once the mailed code is spent, and by the
   * Google sign-up. At this point the user is authenticated. A club or an owner row that cannot be
   * written throws (operator ruling 299): both doors redirect to the club next.
   *
   * Hands back the address of the club it made (operator ruling 304): another
   * one than she asked for when somebody took hers in between. Both doors send
   * her there, never to the address she asked for.
   *
   * An account that owns a club gets no second one (operator ruling 369): a
   * second sign-up with the same address made one, active at once. It hands
   * back the club the account owns, and both doors send it there.
   */
  async completeSignupAfterMagicLink(
    userId: string,
    orgName: string,
    orgSlug: string,
  ): Promise<SignupClub> {
    const owned = await ownedClubSlug(this.supabase, userId);
    if (owned) {
      this.logger.log(`Account ${userId} owns ${owned}: the sign-up made no second club`);
      return { slug: owned, made: false };
    }
    // Re-check slug (race condition guard)
    const slugCheck = await this.checkSlugAvailability(orgSlug);
    if (!slugCheck.available) {
      // Slug was taken between form submission and link click — append a suffix
      const fallbackSlug = `${orgSlug}-${Date.now().toString(36)}`;
      this.logger.warn(`Slug ${orgSlug} taken at callback time, using ${fallbackSlug}`);
      await this.createOrgAndMembership(userId, orgName, fallbackSlug);
      return { slug: fallbackSlug, made: true };
    }
    await this.createOrgAndMembership(userId, orgName, orgSlug);
    return { slug: orgSlug, made: true };
  }

  // ── Shared org creation ──────────────────────────────────────────────────

  private async createOrgAndMembership(
    userId: string,
    orgName: string,
    orgSlug: string,
  ): Promise<void> {
    const { data: org, error: orgError } = await this.supabase.service
      .from('organizations')
      .insert({
        name: orgName,
        slug: orgSlug,
        status: 'active',
        created_by_user_id: userId,
      })
      .select('id')
      .single();

    if (orgError) {
      throw new Error(`Failed to create organization: ${orgError.message}`);
    }

    const { error: memberError } = await this.supabase.service.from('organization_members').insert({
      organization_id: (org as { id: string }).id,
      user_id: userId,
      role: 'owner',
    });

    if (memberError) {
      // A club with no owner holds its address for good and nobody can open it:
      // remove it, so a second try finds the address free.
      const orgId = (org as { id: string }).id;
      const { error: undoError } = await this.supabase.service
        .from('organizations')
        .delete()
        .eq('id', orgId);
      if (undoError) this.logger.error(`Club ${orgId} stays with no owner: ${undoError.message}`);
      throw new Error(`Failed to create org membership: ${memberError.message}`);
    }

    this.logger.log(`Created org ${orgSlug} with owner ${userId}`);
  }
}
