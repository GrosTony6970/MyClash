import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SIGNUPS_DISABLED_CODE } from '@myclash/types';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { validatePassword } from '@myclash/types';
import { MailService } from '../mail/mail.service';
import { mailedLink, signInDoor } from '../mail/mailed-link';
// Value import, not `import type`: Nest reads design:paramtypes to inject it.
import {
  LegalAcceptanceService,
  type AcceptanceContext,
  type AcceptedLegalVersions,
} from '../privacy/legal-acceptance.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RESERVED_SLUGS, type SignupDto } from './dto/signup.dto';

export type SignupResult =
  | {
      /** 'magic_link' — email sent, user must click to complete signup */
      type: 'magic_link';
      message: string;
      orgSlug: string;
    }
  | {
      /** 'password' — account created, email verification required */
      type: 'password';
      message: string;
      orgSlug: string;
      emailVerificationRequired: true;
    };

/**
 * The shared rule from @myclash/types, not a local length check.
 *
 * This path creates the ORG OWNER — the highest-privilege account on the
 * platform — and it used to accept 8 characters with no class rules, while a
 * spectator signing up on the public app had to clear 12 plus four classes.
 *
 * Throws the structured `failing` list rather than a sentence, so the signup
 * form can tick its checklist instead of showing one opaque message.
 */
function assertPasswordMeetsPolicy(password: string | undefined): void {
  const validation = validatePassword(password ?? '');
  if (!validation.ok) {
    throw new BadRequestException({ code: 'weak_password', failing: validation.failing });
  }
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
   */
  async assertSignupsOpen(): Promise<void> {
    if (await isFlagEnabledDirect(this.supabase, 'disable_signups')) {
      throw new OperationalUnavailableException({
        code: SIGNUPS_DISABLED_CODE,
        message: 'Signups are temporarily disabled',
      });
    }
  }

  // ── Signup ───────────────────────────────────────────────────────────────

  async signup(dto: SignupDto, context: AcceptanceContext = {}): Promise<SignupResult> {
    const { email, displayName, method, password, orgName, orgSlug } = dto;
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

    // 2. Validate password if method='password'
    if (method === 'password') assertPasswordMeetsPolicy(password);

    if (method === 'magic_link') {
      return this.signupWithMagicLink(email, displayName, orgName, normalizedSlug, versions);
    } else {
      return this.signupWithPassword(
        email,
        displayName,
        password!,
        orgName,
        normalizedSlug,
        versions,
        context,
      );
    }
  }

  // ── Magic link path ──────────────────────────────────────────────────────

  private async signupWithMagicLink(
    email: string,
    displayName: string,
    orgName: string,
    orgSlug: string,
    versions: AcceptedLegalVersions,
  ): Promise<SignupResult> {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const protocol = 'https';

    // The mailed link lands on the sign-up door and carries the org creation
    // payload, so the door makes the org right after it signs her in.
    //
    // The accepted versions ride along for the same reason the org payload
    // does: on this path no auth.users row exists yet, so there is nothing to
    // attach an acceptance to until the link is clicked. They were already
    // checked against the registry above — carrying them keeps the record
    // faithful to what the user actually ticked, even if the policy is revised
    // between sending the mail and clicking the link.
    const door = `${protocol}://admin.${domain}/api/v1/auth/signup-callback?orgName=${encodeURIComponent(orgName)}&orgSlug=${encodeURIComponent(orgSlug)}&displayName=${encodeURIComponent(displayName)}&acceptedTerms=${encodeURIComponent(versions.terms)}&acceptedPrivacy=${encodeURIComponent(versions.privacy)}`;

    const { data, error } = await this.supabase.service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { data: { display_name: displayName } },
    });
    // Our door with GoTrue's code, never GoTrue's own link (ruling 303).
    const magicLink = mailedLink(door, data.properties);

    if (error || !magicLink) {
      this.logger.error(`Failed to generate signup magic link for ${email}: ${error?.message}`);
      throw new BadRequestException('Failed to send signup link. Please try again.');
    }

    await this.mail.sendMagicLink({ to: email, magicLink, type: 'login', displayName });

    this.logger.log(`Signup magic link sent to ${email} for org ${orgSlug}`);

    return {
      type: 'magic_link',
      message: 'Check your email for a signup link.',
      orgSlug,
    };
  }

  // ── Password path ────────────────────────────────────────────────────────

  private async signupWithPassword(
    email: string,
    displayName: string,
    password: string,
    orgName: string,
    orgSlug: string,
    versions: AcceptedLegalVersions,
    context: AcceptanceContext,
  ): Promise<SignupResult> {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');

    // Create the Supabase auth user (email_confirmed_at = NULL until verified)
    const { data: authData, error: authError } = await this.supabase.service.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // requires email verification
      user_metadata: { display_name: displayName },
    });

    if (authError || !authData.user) {
      if (authError?.message?.toLowerCase().includes('already registered')) {
        throw new ConflictException('An account with this email already exists');
      }
      this.logger.error(`Failed to create user for ${email}: ${authError?.message}`);
      throw new BadRequestException('Failed to create account. Please try again.');
    }

    const userId = authData.user.id;
    await this.finishOrUndoAccount(userId, versions, context, { orgName, orgSlug });

    // Send email verification link via magic link (verifies email on click):
    // the sign-in door, then her club's page (ruling 303).
    try {
      const { data: linkData } = await this.supabase.service.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      const magicLink = mailedLink(
        signInDoor(domain, 'login', `/org/${orgSlug}`),
        linkData.properties,
      );

      if (magicLink) {
        await this.mail.sendMagicLink({ to: email, magicLink, type: 'login', displayName });
      }
    } catch (err) {
      // Non-fatal — user can request a new verification email
      this.logger.warn(`Could not send verification email to ${email}: ${String(err)}`);
    }

    this.logger.log(`Password signup complete for ${email}, org ${orgSlug}`);

    return {
      type: 'password',
      message:
        'Account created. Please check your email to verify your address before creating events.',
      orgSlug,
      emailVerificationRequired: true,
    };
  }

  // ── Signup callback (magic link path) ───────────────────────────────────

  /**
   * Called after the magic link is clicked, and by the Google sign-up. At this
   * point the user is authenticated. A club or an owner row that cannot be
   * written throws (operator ruling 299): both doors redirect to the club next.
   *
   * Hands back the address of the club it made (operator ruling 304): another
   * one than she asked for when somebody took hers in between. Both doors send
   * her there, never to the address she asked for.
   */
  async completeSignupAfterMagicLink(
    userId: string,
    orgName: string,
    orgSlug: string,
  ): Promise<string> {
    // Re-check slug (race condition guard)
    const slugCheck = await this.checkSlugAvailability(orgSlug);
    if (!slugCheck.available) {
      // Slug was taken between form submission and link click — append a suffix
      const fallbackSlug = `${orgSlug}-${Date.now().toString(36)}`;
      this.logger.warn(`Slug ${orgSlug} taken at callback time, using ${fallbackSlug}`);
      await this.createOrgAndMembership(userId, orgName, fallbackSlug);
      return fallbackSlug;
    }
    await this.createOrgAndMembership(userId, orgName, orgSlug);
    return orgSlug;
  }

  // ── Shared org creation ──────────────────────────────────────────────────

  /**
   * What a password sign-up owes the account it made a moment ago: the record
   * of what she accepted, then her club. When either cannot be written the
   * account is removed and the sign-up fails (operator ruling 306). No screen
   * lets an account with no club make one, and a second sign-up with her
   * address would be refused as "already registered".
   */
  private async finishOrUndoAccount(
    userId: string,
    versions: AcceptedLegalVersions,
    context: AcceptanceContext,
    club: { orgName: string; orgSlug: string },
  ): Promise<void> {
    try {
      await this.legal.recordForUser(userId, versions, context);
      await this.createOrgAndMembership(userId, club.orgName, club.orgSlug);
    } catch (err) {
      const undone = await this.supabase.deleteAuthAdminUser(userId);
      if (!undone.ok) {
        this.logger.error(
          `Account ${userId} stays with no club: removal answered ${undone.status}`,
        );
      }
      throw err;
    }
  }

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
