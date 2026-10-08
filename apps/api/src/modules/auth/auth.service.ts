import { createHash, randomBytes } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ADMIN_LOCKDOWN_CODE,
  CLAIM_REFUSED_PARAM,
  SIGNUP_REFUSED_PARAM,
  SIGNUPS_DISABLED_CODE,
  WRONG_CURRENT_PASSWORD_CODE,
  validatePassword,
  type ClaimLinkRefusal,
} from '@myclash/types';
import { adminLockdownRefusal, isAdminLockdownRefusal } from '../../common/admin-lockdown';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { assertNotReadOnly } from '../../common/read-only-mode';
import { isPlatformStaff, readPlatformRole } from '../../common/auth/platform-role';
import { MailService } from '../mail/mail.service';
import { mailedLink, signInDoor } from '../mail/mailed-link';
import {
  knownRosterRows,
  publiclyKnownProfileIds,
  visibleEventRows,
} from '../../common/auth/hidden-entrants';
import { getStaffSession } from '../../common/auth/identity';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { OnboardingService } from '../organizations/onboarding.service';
import { OrganizationsService } from '../organizations/organizations.service';
// Value import, not `import type`: Nest reads the constructor's design:paramtypes
// metadata to inject it, and a type-only import erases that at compile time.
import { ErasureService } from '../privacy/erasure.service';
import {
  applyReachable,
  isReachable,
  isReachableEmbed,
  type ReachableRow,
} from '../fighters/directory-predicate';
import { isFieldPublic } from '../fighters/public-visibility';
import {
  LegalAcceptanceService,
  type AcceptanceContext,
  type LegalAcceptanceSummary,
} from '../privacy/legal-acceptance.service';
import type { LegalDocumentKind } from '@myclash/types';
import {
  buildClearCookieOptions,
  buildSessionCookieOptions,
  isProductionEnvironment,
} from '../../security/http-security';
import { SupabaseService, type SupabaseAuthUser } from '../supabase/supabase.service';
import { syncClaimedPersonRows } from './claimed-person-sync';
import { searchClaimableProfiles } from './claim-search';
import { personEmailMatchesUser } from './person-email-match';
import { linkWouldMakeAccount } from './read-only-link';
import { anotherNameOnRoster, type NamedProfile } from './roster-names-of-address';
import type { MeResponseDto } from './dto/me-response.dto';
import type { OAuthSessionDto } from './dto/oauth-session.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';
import type { PersonalSpaceResponseDto } from './dto/personal-space-response.dto';
import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { guestPersonOf } from './guest-person';
import { GuestJwtService, type GuestJwtPayload } from './guest-jwt.service';
import { safeRedirectPath } from './safe-redirect';
import { signsInWithPassword } from './sign-in-methods';

/** What the CHECK of a claim can answer. The write has one more: `already_at_event`. */
type ClaimCheckRefusal = Exclude<ClaimLinkRefusal, 'already_at_event'>;

/**
 * What the one claim door that answers with an error throws for each refusal: the
 * anonymous link request. The emailed link's callback and the Google claim
 * hand on the reason instead (rulings 57, 307).
 */
const CLAIM_REFUSAL_ERRORS: Record<ClaimCheckRefusal, () => HttpException> = {
  check_failed: () => new BadRequestException('Could not validate profile claim'),
  not_found: () => new NotFoundException('Person not found'),
  email_mismatch: () => new BadRequestException('Email does not match the registered person'),
  held_by_another: () => new BadRequestException('This profile has already been claimed'),
};

/** The unique index of migration 0220: one roster row per account at an Event (ruling 296). */
const ONE_ROW_PER_ACCOUNT_AT_EVENT = 'persons_event_id_claimed_by_user_id_key';

// Sliding-session lifetime for the auth cookies (30 days). The access token's
// own JWT exp (GOTRUE_JWT_EXP, ~1h) still governs validity; when it expires or
// is about to, `getMe` mints a fresh one from the refresh-token cookie and re-sets both
// cookies. This long maxAge just keeps the cookies on disk so that renewal can
// happen — previously both cookies were capped at 1h with no refresh, so every
// session hard-expired after an hour.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// `getMe` also renews a login with less than this left, so a screen that calls
// /me every minute swaps its token before the API reads it as a stranger
// (operator ruling 94). Well above that minute, well below the 1h token.
const RENEW_WITHIN_SECONDS = 5 * 60;

/** Does this access token end within `seconds`? A token with no readable `exp` does not. */
function endsWithin(accessToken: string, seconds: number): boolean {
  const exp = (jwt.decode(accessToken) as { exp?: unknown } | null)?.exp;
  return typeof exp === 'number' && exp * 1000 - Date.now() < seconds * 1000;
}

// Entropy for the global-profile claim token, matching the same one-time
// emailed-token flow in PersonEmailChangeService. 32 bytes base64url encodes
// to 43 chars, which fits the DTO's 20..64 bound.
const CLAIM_TOKEN_BYTES = 32;

type GoTruePasswordTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
  };
};

type AdminLandingContext = NonNullable<MeResponseDto['admin']>;

/**
 * Public projection of a global_persons row for the self-service
 * claim search UI. Never exposes email or DOB — those would let
 * anonymous probing harvest identity data.
 */
export interface GlobalPersonSearchResult {
  id: string;
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  country_code: string | null;
  hema_ratings_id: string | null;
  club_label: string | null;
}

function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? (local[0] ?? '') : `${local[0]}***${local[local.length - 1]}`;
  return `${visible}@${domain}`;
}

type DashboardRow = Record<string, unknown>;
interface RowPlace {
  eventId: string;
  tournamentId: string | null;
}

/** The Tournament of an embed reaching `phases(tournament_id)`, or null without one. */
const tournamentOf = (embed: unknown): string | null =>
  (embed as { phases?: { tournament_id?: string } } | null)?.phases?.tournament_id ?? null;

/** A duty's Event and Tournament: its Pool's or its bout's; a piste duty has none (0091's CHECK). */
const dutyPlace = (duty: DashboardRow): RowPlace => ({
  eventId: duty['event_id'] as string,
  tournamentId: tournamentOf(duty['pools']) ?? tournamentOf(duty['matches']),
});

/** A Workshop booking's Event: a Workshop belongs to no Tournament. */
const bookingPlace = (booking: DashboardRow): RowPlace => ({
  eventId: (booking['workshop_sessions'] as { workshops?: { event_id?: string } } | null)?.workshops
    ?.event_id as string,
  tournamentId: null,
});

function normalizeOrganizationMembership(
  row: unknown,
): AdminLandingContext['organizations'][number] | null {
  if (!row || typeof row !== 'object') return null;

  const record = row as {
    role?: unknown;
    organizations?: unknown;
  };
  const organization = Array.isArray(record.organizations)
    ? record.organizations[0]
    : record.organizations;

  if (!organization || typeof organization !== 'object') return null;

  const orgRecord = organization as { id?: unknown; slug?: unknown; name?: unknown };
  if (
    typeof record.role !== 'string' ||
    typeof orgRecord.id !== 'string' ||
    typeof orgRecord.slug !== 'string' ||
    typeof orgRecord.name !== 'string'
  ) {
    return null;
  }

  return {
    id: orgRecord.id,
    slug: orgRecord.slug,
    name: orgRecord.name,
    role: record.role,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    // Required, not optional: deleteAccount cannot satisfy Art. 17 without it,
    // so a missing wiring must fail at boot rather than at erasure time.
    private readonly erasure: ErasureService,
    // Also required: an account-creation path that cannot record an acceptance
    // is one whose consent we can never evidence, so a missing wiring must fail
    // at boot rather than silently at signup.
    private readonly legal: LegalAcceptanceService,
    // The draft bar on the profiles a user may claim (ruling 171a): who is a club member.
    private readonly orgs: OrganizationsService,
    private readonly guestJwt?: GuestJwtService,
    private readonly onboarding?: OnboardingService,
  ) {}

  // ── Magic link request ──────────────────────────────────────────────────

  async requestMagicLink(dto: RequestMagicLinkDto): Promise<{ message: string }> {
    const { email, type, personId, redirectTo } = dto;

    const safeRedirect = safeRedirectPath(redirectTo);

    if (type === 'claim') {
      if (!personId) {
        throw new BadRequestException('personId is required for claim type');
      }
      await this.assertClaimable(personId, email, null);
    }

    // Read-only mode makes no account (ruling 347): the auth server makes one for a new address.
    if (await linkWouldMakeAccount(this.supabase, email)) {
      return { message: 'If this email is registered, a link has been sent.' };
    }

    // The code comes from Supabase Auth (GoTrue); the link is ours (ruling 303).
    const { data, error } = await this.supabase.service.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const magicLink = mailedLink(signInDoor(domain, type, safeRedirect, personId), data.properties);

    if (error || !magicLink) {
      this.logger.error(`Failed to generate magic link for ${email}: ${error?.message}`);
      // Return generic message to prevent email enumeration
      return { message: 'If this email is registered, a link has been sent.' };
    }

    await this.mail.sendMagicLink({
      to: email,
      magicLink,
      type: type === 'public_login' ? 'login' : type,
    });

    return { message: 'If this email is registered, a link has been sent.' };
  }

  // ── Magic link callback ─────────────────────────────────────────────────

  async acceptOAuthSession(
    dto: OAuthSessionDto,
    reply: FastifyReply,
    context: AcceptanceContext = {},
  ): Promise<void> {
    const user = await this.requestAuthUser(dto.accessToken);

    if (!user) {
      throw new UnauthorizedException('Invalid OAuth session');
    }

    let destination = safeRedirectPath(dto.next);

    if (dto.mode === 'admin_login') {
      const allowed = await this.hasAdminAccess(user.id);
      if (!allowed) {
        throw new ForbiddenException('No organizer or super admin access for this account');
      }
      await this.assertNotLockedOut(user.id);
      destination = destination === '/' ? '/dashboard' : destination;
    }

    if (dto.mode === 'organizer_signup') {
      const made = await this.signUpWithGoogle(user.id, dto, context);
      destination = destination === '/' ? `/org/${made}` : destination;
    }

    if (dto.mode === 'person_claim') {
      if (!dto.personId) {
        throw new BadRequestException('personId is required for person claim');
      }
      if (!user.email) {
        throw new ForbiddenException('Google account did not provide an email address');
      }
      // A refusal is an answer, as at the mailed link (operator ruling 307): she is
      // signed in below and reads the reason on the claim page of the row's Event.
      destination = (await this.claimFromLink(user.id, user.email, dto.personId)) ?? destination;
    }

    if (dto.mode === 'public_login') {
      destination = destination === '/' ? '/me' : destination;
    }

    this.setAuthCookies(reply, dto.accessToken, dto.refreshToken);
    await this.tryAutolinkGlobalPerson(user.id, user.email ?? null);
    void reply.send({ next: destination });
  }

  /**
   * The Google sign-up's club. Hands back the address of the club that was
   * made: another one than she asked for when somebody took hers in between
   * (operator ruling 304).
   */
  private async signUpWithGoogle(
    userId: string,
    dto: OAuthSessionDto,
    context: AcceptanceContext,
  ): Promise<string> {
    if (!dto.orgName?.trim() || !dto.orgSlug?.trim()) {
      throw new BadRequestException('Organization name and slug are required');
    }
    if (!this.onboarding) {
      throw new BadRequestException('Organizer signup is not available');
    }
    // "Sign-ups off" is off here too (operator ruling 305): only the form read it.
    await this.onboarding.assertSignupsOpen();
    // Checked before the org is created: a signup that fails the policy check
    // must not leave a half-made organisation behind.
    const versions = this.legal.assertCurrent({
      terms: dto.acceptedTerms,
      privacy: dto.acceptedPrivacy,
    });
    const made = await this.onboarding.completeSignupAfterMagicLink(
      userId,
      dto.orgName,
      dto.orgSlug,
    );
    await this.legal.recordForUser(userId, versions, context);
    return made;
  }

  async passwordLogin(dto: PasswordLoginDto, reply: FastifyReply): Promise<void> {
    const destination = safeRedirectPath(dto.redirectTo);
    const tokenResponse = await this.requestPasswordToken(dto.email, dto.password);

    if (!tokenResponse.access_token || !tokenResponse.refresh_token || !tokenResponse.user?.id) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const allowed = await this.hasAdminAccess(tokenResponse.user.id);
    if (!allowed) {
      throw new ForbiddenException('No organizer or super admin access for this account');
    }

    await this.assertNotLockedOut(tokenResponse.user.id);

    this.setAuthCookies(
      reply,
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      tokenResponse.expires_in,
    );
    await this.tryAutolinkGlobalPerson(tokenResponse.user.id, dto.email);
    void reply.send({ next: destination === '/' ? '/dashboard' : destination });
  }

  private async assertNotLockedOut(userId: string): Promise<void> {
    const lockdownOn = await this.isAdminLockdownEnabled();
    if (!lockdownOn) return;

    // Platform staff of any tier bypass lockdown — mirrors LockdownInterceptor.
    // A locked-out platform admin could not even sign in to help.
    if (await isPlatformStaff(this.supabase, userId)) return;

    throw adminLockdownRefusal();
  }

  /** Public for the mailed sign-up link's door, which asks before it spends the link. */
  async isAdminLockdownEnabled(): Promise<boolean> {
    try {
      const { data } = await this.supabase.service
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'admin_lockdown')
        .maybeSingle();
      return Boolean((data as { enabled?: boolean } | null)?.enabled);
    } catch {
      return false;
    }
  }

  logout(reply: FastifyReply): { ok: true } {
    const cookieReply = reply as FastifyReply & {
      clearCookie: (name: string, opts: Record<string, unknown>) => void;
    };
    const clearOptions = buildClearCookieOptions(
      this.config.get<string>('NODE_ENV'),
      this.cookieDomain(),
    );

    cookieReply.clearCookie('sb-access-token', clearOptions);
    cookieReply.clearCookie('sb-refresh-token', clearOptions);

    return { ok: true };
  }

  /**
   * The emailed link's landing: exchange the code for a session, set the
   * cookies, redirect into the app.
   *
   * A claim link whose row refuses the claim still signs its reader in — the
   * link proved they own the address, which is all the mail tested — and then
   * sends them to the claim page with the reason instead of throwing after the
   * cookies are set, which left them signed in on a raw 400 with nothing to
   * click (ruling 57). A claim WRITE that fails for a reason that is no refusal
   * still throws there (ruling 300). The sign-in autolink runs on that path too: they are
   * signed in as themselves, so the profile carrying their address is theirs as
   * on any sign-in (ruling 47), and its sweep claims only rows nobody holds
   * (`claimed_by_user_id IS NULL`) carrying that address — never the row
   * another account holds.
   */
  async handleCallback(
    token: string,
    type: string,
    personId: string | undefined,
    next: string | undefined,
    reply: FastifyReply,
  ): Promise<void> {
    const user = await this.exchangeLink(token, type, reply).catch((refusal: unknown) => {
      if (isAdminLockdownRefusal(refusal)) return null;
      throw refusal;
    });
    if (!user) {
      // A browser that followed a link cannot read a 503 (ruling 324): the
      // sign-in page says the lockdown. The code is spent, the cookies are not set.
      const page = `/login?${SIGNUP_REFUSED_PARAM}=${ADMIN_LOCKDOWN_CODE}`;
      void reply.redirect(this.buildPostAuthRedirectUrl(page, type));
      return;
    }

    const refusedPath =
      type === 'claim' && personId ? await this.claimFromLink(user.id, user.email, personId) : null;

    // Silent autolink to a matching global profile on any login path
    // (login / public_login / claim — all benefit).
    await this.tryAutolinkGlobalPerson(user.id, user.email ?? null);

    // Redirect to appropriate destination
    const safeRedirect = safeRedirectPath(next);
    const path =
      type === 'public_login'
        ? safeRedirect === '/'
          ? '/me'
          : safeRedirect
        : type === 'login'
          ? safeRedirect === '/'
            ? '/dashboard'
            : safeRedirect
          : safeRedirect;
    const destination = this.buildPostAuthRedirectUrl(refusedPath ?? path, type);
    void reply.redirect(destination);
  }

  /**
   * The emailed sign-up link's landing: signs its reader in and hands back the
   * account the link proved (operator ruling 299). It sends no answer: the
   * sign-up door makes the club for that account, then redirects.
   */
  async signInFromSignupLink(
    token: string,
    reply: FastifyReply,
  ): Promise<{ id: string; email?: string }> {
    const user = await this.exchangeLink(token, 'login', reply);
    await this.tryAutolinkGlobalPerson(user.id, user.email ?? null);
    return user;
  }

  /** Exchange an emailed link's code for a session and set its cookies. */
  private async exchangeLink(
    token: string,
    type: string,
    reply: FastifyReply,
  ): Promise<{ id: string; email?: string }> {
    // 'email' takes the code of a new address and of a known one. Asked as
    // 'magiclink', GoTrue refuses the code it made for an address with no account.
    const { data, error } = await this.supabase.anon.auth.verifyOtp({
      token_hash: token,
      type: 'email',
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const { session } = data;

    if (type === 'login') {
      await this.assertNotLockedOut(session.user.id);
    }

    this.setAuthCookies(
      reply,
      session.access_token,
      session.refresh_token ?? '',
      session.expires_in,
    );
    return session.user;
  }

  /**
   * The claim of the emailed link and of the Google claim (ruling 307). The
   * roster row comes from the link's address, not from the sign-in code, so
   * anyone signed in with a code for their own address could name any row
   * (ruling 46).
   *
   * Answers null when the row is claimed, else the in-app path to send the
   * reader to with the reason (ruling 57): the claim page of the row's Event,
   * or /me when no row was read to name an Event by (ruling 59).
   */
  private async claimFromLink(
    userId: string,
    userEmail: string | undefined,
    personId: string,
  ): Promise<string | null> {
    const checked = await this.claimRefusal(personId, userEmail, userId);
    const { eventSlug } = checked;
    // The check, then the write: the database refuses a second row at an Event (ruling 300).
    const refusal = checked.refusal ?? (await this.completeClaim(userId, userEmail, personId));
    if (!refusal) return null;
    this.logger.warn(`claim of person ${personId} refused: ${refusal}`);
    const reason = `${CLAIM_REFUSED_PARAM}=${refusal}`;
    return eventSlug
      ? `/e/${encodeURIComponent(eventSlug)}/claim?personId=${encodeURIComponent(personId)}&${reason}`
      : `/me?${reason}`;
  }

  // ── /me endpoint ────────────────────────────────────────────────────────

  async getMe(request: FastifyRequest, reply?: FastifyReply): Promise<MeResponseDto> {
    const accessToken = this.extractToken(request);
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const guestToken = cookies?.['mc_guest'];
    const refreshToken = cookies?.['sb-refresh-token'];

    // ── Claimed path ──────────────────────────────────────────────────────
    const user = await this.resolveClaimedUser(accessToken, refreshToken, reply);
    if (user) {
      return this.buildClaimedResponse(user, guestToken, reply);
    }

    // ── Guest path, else anonymous ────────────────────────────────────────
    return this.buildGuestResponse(guestToken);
  }

  /** What `/me` answers a caller with no login: her guest session, or anonymous. */
  private async buildGuestResponse(guestToken: string | undefined): Promise<MeResponseDto> {
    if (!guestToken || !this.guestJwt) return { type: 'anonymous' };
    let payload: GuestJwtPayload;
    try {
      payload = this.guestJwt.verify(guestToken);
    } catch {
      // Invalid/expired guest token
      return { type: 'anonymous' };
    }

    // A read that fails below is no verdict: it throws, and the pages keep what they show
    // (an unreadable `/me` is not "signed out").
    const { data: sessionData, error: sessionError } = await this.supabase.service
      .from('guest_sessions')
      .select('id, device_label, expires_at, revoked_at')
      .eq('id', payload.sub)
      .maybeSingle();
    if (sessionError) throw new Error(`Guest session unreadable: ${sessionError.message}`);
    const s = sessionData as {
      device_label: string;
      expires_at: string;
      revoked_at: string | null;
    } | null;
    // Revoked sessions are treated as anonymous
    if (!s || s.revoked_at) return { type: 'anonymous' };

    const { data: personData, error: personError } = await this.supabase.service
      .from('persons')
      .select(
        'id, given_name, family_name, event_id, claim_status, claimed_by_user_id, events ( slug )',
      )
      .eq('id', payload.person_id)
      .maybeSingle();
    if (personError) throw new Error(`Guest's roster row unreadable: ${personError.message}`);
    const { holder, person } = guestPersonOf(personData);
    // A session on a name an account holds is no identity (ruling 265), here as at
    // the booking door (`ParticipantIdentityService`).
    if (holder) return { type: 'anonymous' };

    return {
      type: 'guest',
      person,
      session: { device_label: s.device_label, expires_at: s.expires_at },
    };
  }

  /**
   * The signed-in user, with the login renewed from the refresh-token cookie
   * when the access token is missing, expired, or ends within five minutes
   * (sliding session, ruling 94). Needs `reply` so the rotated cookies can be
   * written back; without it the caller keeps what the current token says. A
   * refused early renewal keeps the still-valid user; the next call retries.
   *
   * Race: two tabs renewing at once present the same refresh token. GoTrue's
   * reuse interval (10 s in production) accepts both when they land within it,
   * as it already did for an expired token; once one lands, the shared cookie
   * carries the new token and the others no longer renew.
   */
  private async resolveClaimedUser(
    accessToken: string | null,
    refreshToken: string | undefined,
    reply: FastifyReply | undefined,
  ): Promise<SupabaseAuthUser | null> {
    const user = accessToken ? await this.requestAuthUser(accessToken) : null;
    const renew = !user || (accessToken !== null && endsWithin(accessToken, RENEW_WITHIN_SECONDS));
    if (!renew || !refreshToken || !reply) return user;
    const refreshed = await this.supabase.refreshSession(refreshToken);
    if (!refreshed) return user;
    this.setAuthCookies(
      reply,
      refreshed.access_token,
      refreshed.refresh_token,
      refreshed.expires_in,
    );
    return (await this.requestAuthUser(refreshed.access_token)) ?? user;
  }

  private async buildClaimedResponse(
    user: SupabaseAuthUser,
    guestToken: string | undefined,
    reply?: FastifyReply,
  ): Promise<MeResponseDto> {
    // Both claimed + guest present → claimed wins, clear the guest cookie.
    if (guestToken && reply) {
      const cookieReply = reply as FastifyReply & {
        clearCookie: (name: string, opts: Record<string, unknown>) => void;
      };
      cookieReply.clearCookie(
        'mc_guest',
        buildClearCookieOptions(this.config.get<string>('NODE_ENV')),
      );
    }

    // No roster row is read: an account on two Events has two, and none is "hers".
    // Her name is her profile's (ruling 298).
    const profile = await this.readOwnProfile(user.id);
    const admin = await this.getAdminLandingContext(user.id);

    // Gates the "My leagues" nav entry + the /dashboard league branch.
    // Deliberately a cheap existence check rather than listManageable, whose
    // count enrichment pulls every league_rankings row into memory — far too
    // heavy for /me.
    const hasLeagueRoles = await this.readLeagueGrant(user.id);

    // One indexed lookup; it never throws (see LegalAcceptanceService.pendingFor).
    const pendingLegal = await this.legal.pendingFor(user.id);

    return {
      type: 'claimed',
      user: {
        id: user.id,
        email: user.email ?? '',
        display_name: user.user_metadata?.['display_name'] as string | undefined,
        photo_url: profile.photoUrl,
        profile_name: profile.name,
      },
      admin: { ...admin, hasLeagueRoles },
      pendingLegal,
    };
  }

  async getPersonalSpace(request: FastifyRequest): Promise<PersonalSpaceResponseDto> {
    const accessToken = this.extractToken(request);
    if (!accessToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.requestAuthUser(accessToken);
    if (!user) {
      throw new UnauthorizedException('Invalid session');
    }

    // Only what the draft bar lets her know of (ruling 172); the filters 5xx on a failed read.
    const reader = { userId: user.id, staff: getStaffSession(request) };
    const [claimedPersons, globalPerson, refereeAssignments, workshopEnrollments, claimable] =
      await Promise.all([
        this.fetchClaimedPersons(user.id).then((rows) => this.knownClaimed(rows, reader)),
        this.fetchGlobalPerson(user.id),
        this.fetchRefereeAssignments(user.id).then((rows) => this.visible(rows, dutyPlace, reader)),
        this.fetchWorkshopEnrollments(user.id).then((rows) =>
          this.visible(rows, bookingPlace, reader),
        ),
        this.fetchClaimablePersons(user, request),
      ]);
    const eventIds = new Set(claimedPersons.map((person) => person['event_id']));

    return {
      user: {
        id: user.id,
        email: user.email ?? '',
        display_name: user.user_metadata?.['display_name'] as string | undefined,
      },
      profiles: {
        globalPerson,
        claimedPersons,
      },
      commitments: {
        refereeAssignments,
        workshopEnrollments,
      },
      counts: {
        claimedPersons: claimedPersons.length,
        events: eventIds.size,
        refereeAssignments: refereeAssignments.length,
        workshopEnrollments: workshopEnrollments.length,
      },
      claimable,
    };
  }

  /**
   * Confirm-to-claim: claim the given roster `persons` rows for the logged-in
   * user. Each id is guarded by the same email-match rule the per-event claim
   * uses (`personEmailMatchesUser`) — non-matching / foreign-owned ids are
   * skipped. Idempotent. Returns how many were claimed/owned, and how many the
   * database refused because the account already holds a row at that Event
   * (ruling 300): the page says so.
   */
  async claimPersons(
    request: FastifyRequest,
    personIds: string[],
  ): Promise<{ claimed: number; alreadyAtEvent: number }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user || !user.email) throw new UnauthorizedException('Invalid session');

    let claimed = 0;
    let alreadyAtEvent = 0;
    for (const personId of personIds) {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select('id, email, claimed_by_user_id')
        .eq('id', personId)
        .maybeSingle();
      // A failed read is not "no such row": that answered "0 claimed" and said nothing.
      if (error) throw new Error(`Could not read person ${personId}: ${error.message}`);
      const person = data as {
        id: string;
        email: string | null;
        claimed_by_user_id: string | null;
      } | null;
      if (!person) continue;
      // Already owned by someone else → never reassign.
      if (person.claimed_by_user_id && person.claimed_by_user_id !== user.id) continue;
      if (!personEmailMatchesUser(person.email, user.email)) continue;
      if (await this.completeClaim(user.id, user.email, personId)) alreadyAtEvent += 1;
      else claimed += 1;
    }
    return { claimed, alreadyAtEvent };
  }

  /**
   * Unclaimed roster profiles whose registered email matches the user's —
   * the confirm-step suggestions for the /me dashboard. Only rows the draft bar
   * lets her know of (ruling 171a, `knownRosterRows`); like the dashboard's
   * other reads, a failed one offers nothing, so never a hidden row. The reader is
   * her login and the request's staff cookie. No row at an Event where her
   * account already holds one (ruling 300).
   */
  private async fetchClaimablePersons(
    user: SupabaseAuthUser,
    request: FastifyRequest,
  ): Promise<Array<{ id: string; name: string; eventName: string }>> {
    const normalized = (user.email ?? '').trim();
    if (!normalized) return [];
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        // NO `roles` COLUMN EXISTS — on `persons` or on any other table. It
        // 400'd the query, the `if (error) return []` below swallowed it, and
        // the claim-your-profile suggestions were empty for every user who ever
        // had one. Same phantom column killed fetchClaimedPersons.
        .select('id, given_name, family_name, email, claimed_by_user_id, event_id, events(name)')
        .ilike('email', normalized)
        .is('claimed_by_user_id', null);
      if (error) return [];
      // The database refuses a second row of one account at an Event (0220): a row
      // at an Event where she holds one is not offered (ruling 300). A failed read
      // hides nothing: the row is offered, and the claim says the refusal.
      const held = await this.supabase.service
        .from('persons')
        .select('event_id')
        .eq('claimed_by_user_id', user.id);
      const heldEvents = new Set(
        (held.data ?? []).map((r) => (r as { event_id: string }).event_id),
      );
      const rows = (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])
        .filter((r) => !heldEvents.has(r['event_id'] as string))
        .filter((r) => personEmailMatchesUser(r['email'] as string | null, normalized))
        .map((r) => ({
          id: r['id'] as string,
          eventId: r['event_id'] as string,
          name: `${((r['given_name'] as string) ?? '').trim()} ${((r['family_name'] as string) ?? '').trim()}`.trim(),
          eventName: ((r['events'] as { name?: string } | null)?.name ?? '').trim(),
        }));
      const deps = { supabase: this.supabase, orgs: this.orgs };
      const reader = { userId: user.id, staff: getStaffSession(request) };
      return (await knownRosterRows(deps, rows, reader)).map(({ id, name, eventName }) => ({
        id,
        name,
        eventName,
      }));
    } catch {
      return [];
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Her claimed rows she may know of (`knownRosterRows`, ruling 172). */
  private async knownClaimed(rows: DashboardRow[], reader: PublicReader): Promise<DashboardRow[]> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    const roster = rows.map((row) => ({
      id: row['id'] as string,
      eventId: row['event_id'] as string,
      row,
    }));
    return (await knownRosterRows(deps, roster, reader)).map(({ row }) => row);
  }

  /** Her duties or bookings she may know of (`visibleEventRows`, ruling 172). */
  private async visible(
    rows: DashboardRow[],
    place: (row: DashboardRow) => RowPlace,
    reader: PublicReader,
  ): Promise<DashboardRow[]> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    const placed = rows.map((row) => ({ ...place(row), row }));
    return (await visibleEventRows(deps, placed, reader)).map(({ row }) => row);
  }

  private async fetchClaimedPersons(userId: string): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select(
          'id, given_name, family_name, email, event_id, global_person_id, claim_status, events(id, slug, name, start_date, end_date, status)',
        )
        .eq('claimed_by_user_id', userId);

      if (error) return [];
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }

  private async fetchGlobalPerson(userId: string): Promise<Record<string, unknown> | null> {
    try {
      // date_of_birth is projected ONLY here (owner-scoped via the
      // claimed_by_user_id filter) — public fighter routes still strip it.
      const { data, error } = await this.supabase.service
        .from('global_persons')
        .select(
          'id, slug, display_name, given_name, family_name, country_code, date_of_birth, is_fighter, is_referee, is_workshop_participant, is_instructor',
        )
        .eq('claimed_by_user_id', userId)
        .maybeSingle();

      if (error || !data) return null;
      return data as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async fetchRefereeAssignments(userId: string): Promise<Record<string, unknown>[]> {
    try {
      // Post-0063: referee_assignments keys on person_id. Resolve the
      // caller's JWT user_id → global_persons.id once, then query.
      const { data: gp } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .eq('claimed_by_user_id', userId)
        .maybeSingle();
      const personId = (gp as { id: string } | null)?.id;
      if (!personId) return [];

      const { data, error } = await this.supabase.service
        .from('referee_assignments')
        .select(
          'id, event_id, role, created_at, events(id, slug, name), pool_id, pools(phases(tournament_id)), matches(id, phase_id, status, scheduled_at, ended_at, phases(tournament_id))',
        )
        .eq('person_id', personId)
        .order('created_at', { ascending: false });

      if (error) return [];
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }

  private async fetchWorkshopEnrollments(userId: string): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase.service
        .from('workshop_enrollments')
        .select(
          'id, status, enrolled_at, workshop_sessions(id, starts_at, ends_at, workshops(id, title, event_id, events(id, slug, name)))',
        )
        .eq('user_id', userId)
        .order('enrolled_at', { ascending: false });

      if (error) return [];
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }

  /** `claimRefusal` for the doors that answer a refusal with an error. */
  private async assertClaimable(
    personId: string,
    email: string | undefined,
    claimingUserId: string | null,
  ): Promise<void> {
    const { refusal } = await this.claimRefusal(personId, email, claimingUserId);
    if (refusal) throw CLAIM_REFUSAL_ERRORS[refusal]();
  }

  /**
   * Why this roster row cannot be claimed, or null when it can — and the slug
   * of its Event, null when no row was read.
   *
   * The row must carry this address (ruling 46). A row with no email matches
   * nobody, and a failed read is `check_failed`, not a verdict about the row.
   *
   * `claimingUserId` null is the emailed-link REQUEST, and the address is the
   * whole check it may make (ruling 53): nobody is signed in there, so a row
   * already claimed BY THE ASKER must not be told from one claimed by somebody
   * else — the typed address is not proof of identity, whatever could be looked
   * up from it. The link goes to that address, which this check has just found
   * to be the row's own, so only its owner can open it, and the redemption
   * decides with an account in hand.
   *
   * At a redemption the row must also be held by nobody else. A row this SAME
   * account already holds passes (ruling 50). A fighter who asks
   * for a claim link and then signs in another way has the row flipped by the
   * autolink before the mail arrives; clicking the link then met a raw 400 about
   * a row that is hers. Re-claiming rewrites the same two values onto the same
   * row, and retries the global-profile link behind it — which ruling 40 gates
   * on the account's own address, so the retry can only repair, never take over.
   *
   * The holder decides, and the status only backs it up: `completeClaim`'s write
   * is scoped by id with no `claimed_by_user_id IS NULL` guard, so a row whose
   * holder is set while its status says otherwise would be handed over to the
   * next asker. No writer produces that state today — every one sets both
   * columns together, and nothing in the schema pairs them — and this is the
   * same bar the /me confirm-to-claim door uses (`claimPersons`).
   */
  private async claimRefusal(
    personId: string,
    email: string | undefined,
    claimingUserId: string | null,
  ): Promise<{ refusal: ClaimCheckRefusal | null; eventSlug: string | null }> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, email, claim_status, claimed_by_user_id, events(slug)')
      .eq('id', personId)
      .maybeSingle();
    if (error) return { refusal: 'check_failed', eventSlug: null };
    if (!data) return { refusal: 'not_found', eventSlug: null };

    const row = data as {
      email: string | null;
      claim_status: string;
      claimed_by_user_id: string | null;
      events: { slug?: string } | null;
    };
    const eventSlug = row.events?.slug ?? null;
    if (!personEmailMatchesUser(row.email, email)) return { refusal: 'email_mismatch', eventSlug };
    if (claimingUserId === null) return { refusal: null, eventSlug };

    const heldByAnother = row.claimed_by_user_id
      ? row.claimed_by_user_id !== claimingUserId
      : row.claim_status === 'claimed';
    return { refusal: heldByAnother ? 'held_by_another' : null, eventSlug };
  }

  /**
   * Writes the claim. Answers null when it landed, else why it did not
   * (operator ruling 300).
   *
   * The database refuses a second roster row of one account at an Event (0220).
   * That refusal is an answer, `already_at_event`, and each door hands it on:
   * a count ("this is me"), or the claim page with the reason (the mailed link
   * and the Google claim, `claimFromLink`). It used to be caught and logged
   * with every other failure, so "this is me" answered "1 claimed" and a claim
   * link landed as a success. Any other failed write throws. The profile link
   * behind the row stays best effort.
   */
  private async completeClaim(
    userId: string,
    userEmail: string | undefined,
    personId: string,
  ): Promise<'already_at_event' | null> {
    const { error } = await this.supabase.service
      .from('persons')
      .update({
        claim_status: 'claimed',
        claimed_by_user_id: userId,
      })
      .eq('id', personId);
    if (error?.message.includes(ONE_ROW_PER_ACCOUNT_AT_EVENT)) return 'already_at_event';
    if (error) throw new Error(`Could not claim person ${personId}: ${error.message}`);

    try {
      await this.linkClaimedPersonGlobalProfile(userId, userEmail, personId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Profile of person ${personId} not linked to ${userId}: ${reason}`);
    }

    // Post-0063: no referee-identity back-fill is needed. Referee tables
    // key on person_id (= global_persons.id), which is stable across the
    // unclaimed → claimed transition. Notification dispatch + "my schedule"
    // resolve the JWT user_id → person_id at request time via
    // global_persons.claimed_by_user_id.
    return null;
  }

  /**
   * Back-fill the roster rows behind a global-person claim — the account's own
   * ones (operator ruling 49(b)). The rule and its cost live with the shared
   * owner in `claimed-person-sync.ts`, which the admin approval also calls.
   */
  private syncPersonsForClaimedGlobalPerson(
    userId: string,
    globalPersonId: string,
    accountEmail: string | null | undefined,
  ): Promise<void> {
    return syncClaimedPersonRows(
      { supabase: this.supabase, logger: this.logger },
      { userId, globalPersonId, accountEmail },
    );
  }

  /**
   * Silent auto-link of an authenticated user to a matching global_persons
   * row by email. Runs at the tail of every successful login path.
   *
   * Rules:
   * - Skip if the user already has a linked global profile (idempotent).
   * - Match must be EXACTLY one unclaimed, unmerged row whose email is this
   *   one, trimmed and lower-cased (ruling 47).
   * - No roster row of this email may have another name than that profile
   *   (ruling 218, `roster-names-of-address.ts`): if one has, nothing is
   *   given, and the repair below is not tried either.
   * - Zero or multiple matches, a failed candidate read or a failed write → the repair from
   *   the Persons the user claimed. It links only a profile carrying this
   *   email (ruling 40): a retry, not a second way in (ruling 45). Failing
   *   that, the user falls through to the manual /me search UI.
   *
   * Trust model: Supabase already verified the email during signup /
   * OAuth, so we trust the match without a second confirmation. The
   * link is reversible via the "Not me?" unlink endpoint.
   */
  async tryAutolinkGlobalPerson(userId: string, email: string | null | undefined): Promise<void> {
    if (!email || !email.trim()) return;
    const normalized = email.trim().toLowerCase();

    try {
      if (await this.holdsLiveProfile(userId)) return;

      const [target, ...others] = await this.unclaimedProfilesWithEmail(normalized);
      if (!target || others.length > 0) {
        await this.tryAutolinkClaimedPersonGlobalProfile(userId, normalized);
        return;
      }
      const deps = { supabase: this.supabase, logger: this.logger };
      if (await anotherNameOnRoster(deps, userId, normalized, target)) return;

      const { error: updateError } = await this.supabase.service
        .from('global_persons')
        .update({ claimed_by_user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', target.id)
        .is('claimed_by_user_id', null);
      if (updateError) {
        this.logger.warn(
          `autolink: update failed for global_persons ${target.id}: ${updateError.message}`,
        );
      } else {
        this.logger.log(`autolink: user ${userId} linked to global_persons ${target.id}`);
        await this.syncPersonsForClaimedGlobalPerson(userId, target.id, normalized);
        return;
      }

      await this.tryAutolinkClaimedPersonGlobalProfile(userId, normalized);
    } catch (err) {
      // Column or table missing pre-migration — silent no-op so login still works.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`autolink skipped (likely pre-migration): ${message}`);
    }
  }

  /**
   * The unclaimed, unmerged profiles that carry exactly this email (ruling 47).
   * `ilike` reads `_` and `%` in an address as wildcards, and PostgREST turns
   * `*` into `%`, so the read can hand back look-alikes; only an exact match is
   * kept. No limit: one could cut the exact row off behind the look-alikes.
   * A failed read finds none, so the caller retries as it does for no match.
   */
  private async unclaimedProfilesWithEmail(email: string): Promise<NamedProfile[]> {
    // An erased, deleted or merged profile is never a candidate (ruling 106).
    const { data, error } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .select('id, email, given_name, family_name')
        .ilike('email', email)
        .is('claimed_by_user_id', null),
    );
    if (error || !Array.isArray(data)) {
      this.logger.warn(`autolink: candidate read failed: ${error?.message}`);
      return [];
    }
    return (data as Array<NamedProfile & { email: string | null }>).filter((row) =>
      personEmailMatchesUser(row.email, email),
    );
  }

  /** Whether the account already holds a live profile: the sign-in gives one, once. */
  private async holdsLiveProfile(userId: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .is('merged_into_id', null)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  private async linkClaimedPersonGlobalProfile(
    userId: string,
    userEmail: string | undefined,
    personId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();
    if (error || !data) return;

    const globalPersonId = (data as { global_person_id: string | null }).global_person_id;
    if (!globalPersonId) return;

    await this.linkGlobalPersonToUserIfSafe(userId, userEmail, globalPersonId);
  }

  private async tryAutolinkClaimedPersonGlobalProfile(
    userId: string,
    userEmail: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('claimed_by_user_id', userId);
    if (error || !Array.isArray(data)) return;

    const globalPersonIds = new Set(
      (data as Array<{ global_person_id: string | null }>)
        .map((row) => row.global_person_id)
        .filter((id): id is string => Boolean(id)),
    );
    if (globalPersonIds.size !== 1) return;

    const globalPersonId = Array.from(globalPersonIds)[0];
    if (!globalPersonId) return;

    await this.linkGlobalPersonToUserIfSafe(userId, userEmail, globalPersonId);
  }

  /**
   * Hands an unclaimed, unmerged global profile to the user, only when the
   * profile carries the account's own email (ruling 40) and no roster row of
   * that email has another name than the profile (ruling 218). An organiser can
   * link a roster row to ANY profile, so owning the row proves nothing about the
   * profile behind it. Such a profile stays unclaimed: with no email, its
   * fighter's /me claim goes to a super admin; with an older one, the /me
   * claim mails that address, or a super admin corrects it; refused for a
   * name (218), it carries the account's own email, so the /me claim mails it.
   */
  private async linkGlobalPersonToUserIfSafe(
    userId: string,
    userEmail: string | undefined,
    globalPersonId: string,
  ): Promise<void> {
    if (await this.holdsLiveProfile(userId)) return;

    const { data: target, error: targetError } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, email, given_name, family_name, claimed_by_user_id, deleted_at, merged_into_id, account_deleted_at',
      )
      .eq('id', globalPersonId)
      .maybeSingle();
    if (targetError || !target) return;

    const row = target as ReachableRow &
      NamedProfile & { email: string | null; claimed_by_user_id: string | null };
    // An erased, deleted or merged profile is never linked (ruling 106).
    if (!isReachable(row) || row.claimed_by_user_id) return;
    if (!userEmail || !personEmailMatchesUser(row.email, userEmail)) {
      this.logger.log(
        `global-person link refused for user ${userId}: global_persons ${globalPersonId} does not carry the account's email`,
      );
      return;
    }
    // Nor when a roster row of that email has another name than the profile (ruling 218).
    const deps = { supabase: this.supabase, logger: this.logger };
    if (await anotherNameOnRoster(deps, userId, userEmail, row)) return;

    const { error: updateError } = await this.supabase.service
      .from('global_persons')
      .update({ claimed_by_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', globalPersonId)
      .is('claimed_by_user_id', null);
    if (updateError) {
      this.logger.warn(
        `global-person link failed for user ${userId} and global_persons ${globalPersonId}: ${updateError.message}`,
      );
      return;
    }
    await this.seedClubFromPersons(userId, globalPersonId);
  }

  /**
   * On claim/link, surface the organiser-entered club: if the global profile
   * has no club yet, seed `global_persons.club_id` + a `fighter_clubs` "main"
   * row from the most-recent claimed `persons.club_id`. Idempotent; never
   * overwrites an existing club (the `.is('club_id', null)` guard + existing
   * main-row check). Best-effort — failures are logged, never thrown.
   */
  private async seedClubFromPersons(userId: string, globalPersonId: string): Promise<void> {
    try {
      const { data: gp } = await this.supabase.service
        .from('global_persons')
        .select('club_id')
        .eq('id', globalPersonId)
        .maybeSingle();
      if ((gp as { club_id: string | null } | null)?.club_id) return;

      const { data: person } = await this.supabase.service
        .from('persons')
        .select('club_id')
        .eq('claimed_by_user_id', userId)
        .not('club_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const clubId = (person as { club_id: string | null } | null)?.club_id ?? null;
      if (!clubId) return;

      await this.supabase.service
        .from('global_persons')
        .update({ club_id: clubId, updated_at: new Date().toISOString() })
        .eq('id', globalPersonId)
        .is('club_id', null);

      const { data: existingMain } = await this.supabase.service
        .from('fighter_clubs')
        .select('id')
        .eq('global_person_id', globalPersonId)
        .eq('role', 'main')
        .maybeSingle();
      if (!existingMain) {
        await this.supabase.service.from('fighter_clubs').insert({
          global_person_id: globalPersonId,
          club_id: clubId,
          role: 'main',
          sort_order: 0,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`club seed skipped for global_persons ${globalPersonId}: ${message}`);
    }
  }

  // ── §6: unlink the current user from their global profile ──────────────

  /**
   * "This isn't me." Wipes claimed_by_user_id on the row currently
   * linked to the caller. Idempotent — if no row matches, returns ok
   * with linked: false. The user can immediately autolink again on
   * next login if the original match was the right one; otherwise
   * the manual self-service claim path remains open.
   */
  async unlinkGlobalPerson(
    request: FastifyRequest,
  ): Promise<{ ok: true; unlinkedGlobalPersonId: string | null }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .update({ claimed_by_user_id: null, updated_at: new Date().toISOString() })
      .eq('claimed_by_user_id', user.id)
      .select('id');
    if (error) {
      throw new ServiceUnavailableException(`Could not unlink: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ id: string }>;
    if (rows.length === 0) {
      return { ok: true, unlinkedGlobalPersonId: null };
    }

    const ids = rows.map((r) => r.id).join(', ');
    this.logger.log(
      `global-person unlink: user ${user.id} → cleared ${rows.length} row(s) [${ids}]`,
    );
    return { ok: true, unlinkedGlobalPersonId: rows[0]!.id };
  }

  // ── §9: /profile/security — change password + delete account ──────────

  /**
   * Tell the UI whether the current user has a usable email/password
   * identity. False means they signed up via Google only — the
   * change-password form needs to swap to a "set initial password
   * via magic link" variant and the delete-account modal needs the
   * email-confirm path (v1: refused with a hint).
   */
  /**
   * What the current user has agreed to, and what is outstanding. Feeds the
   * "your agreements" block in settings and the banner's own re-check after an
   * accept, so the two can never disagree about what is pending.
   */
  async getLegalStatus(request: FastifyRequest): Promise<{
    accepted: LegalAcceptanceSummary[];
    pending: LegalDocumentKind[];
    current: { terms: string; privacy: string };
  }> {
    const user = await this.requireUser(request);
    const [accepted, pending] = await Promise.all([
      this.legal.summaryFor(user.id),
      this.legal.pendingFor(user.id),
    ]);
    return { accepted, pending, current: this.legal.currentVersions() };
  }

  /**
   * Accept the currently published documents. Used by the re-acceptance banner;
   * signup does its own recording inline because the account does not exist yet
   * at the point the checkbox is ticked.
   */
  async acceptLegal(
    request: FastifyRequest,
    accepted: { terms?: string; privacy?: string },
  ): Promise<{ pending: LegalDocumentKind[] }> {
    const user = await this.requireUser(request);
    const versions = this.legal.assertCurrent(accepted);
    await this.legal.recordForUser(user.id, versions, {
      ip: request.ip ?? null,
      userAgent:
        typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });
    return { pending: await this.legal.pendingFor(user.id) };
  }

  /** The authenticated user behind a request, or 401. */
  private async requireUser(request: FastifyRequest): Promise<SupabaseAuthUser> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');
    return user;
  }

  async getSecurityStatus(
    request: FastifyRequest,
  ): Promise<{ hasPassword: boolean; email: string | null }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');

    return { hasPassword: signsInWithPassword(user), email: user.email ?? null };
  }

  /**
   * Change the current user's password. Verifies the current
   * password by re-issuing a Supabase token (grant_type=password),
   * then updates via admin.updateUserById. Supabase ends every
   * session of the account at that write, the caller's own too, so
   * the caller is signed in again (`signInWithNewPassword`).
   */
  async changePassword(
    request: FastifyRequest,
    currentPassword: string,
    newPassword: string,
    reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user || !user.email) throw new UnauthorizedException('Invalid session');

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      throw new BadRequestException({ code: 'weak_password', failing: validation.failing });
    }

    // Re-verify ownership by exchanging email + currentPassword.
    await this.confirmCurrentPassword(user.id, user.email, currentPassword);

    const { error: updateError } = await this.supabase.service.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) {
      throw new ServiceUnavailableException('Could not update password');
    }

    this.logger.log(`password changed for user ${user.id}`);
    await this.signInWithNewPassword(reply, user.id, user.email, newPassword);
    return { ok: true };
  }

  /**
   * Delete the current user's account. Strips claim links from
   * global_persons + persons (history rows survive), removes
   * pending tokens/requests by the user, then deletes the
   * auth.users row via Supabase admin. Idempotent on the row-strip
   * step; the auth delete is the one-shot. An account the auth
   * server lists with a password confirms it; any other is deleted
   * on the typed word. No account is deleted while the auth server is
   * silent: how it signs in is not known then (ruling 349).
   */
  async deleteAccount(
    request: FastifyRequest,
    currentPassword: string,
    confirmation: string,
    reply: FastifyReply,
  ): Promise<void> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user || !user.email) throw new UnauthorizedException('Invalid session');

    if (confirmation !== 'DELETE') {
      throw new BadRequestException({ code: 'confirmation_mismatch' });
    }

    // Accounts WITH a password re-authenticate to confirm. Google-only accounts
    // (no password) delete on the authenticated session + typed confirmation
    // alone — they sign in through Google and have no password to verify.
    if (signsInWithPassword(user)) {
      await this.confirmCurrentPassword(user.id, user.email, currentPassword);
    }

    // Redact the person, keep the competitor: contact details, date of birth,
    // photo, biography, socials, device telemetry and the social graph all go;
    // names stay attached to published results as a public record. ErasureService
    // owns that definition — do not reimplement any of it here.
    //
    // Runs BEFORE the auth delete so a failure leaves the account intact and the
    // whole operation retryable.
    const redacted = await this.erasure.redactSubject(user.id);

    const { error: deleteError } = await this.supabase.service.auth.admin.deleteUser(user.id);
    if (deleteError) {
      throw new ServiceUnavailableException(`Auth delete failed: ${deleteError.message}`);
    }

    // Art. 5(2) receipt, written only once the erasure actually completed.
    await this.erasure.recordErasure(user.id, 'account_deletion', redacted);

    // Clear our own cookies; the Supabase session is gone anyway.
    const cookieReply = reply as FastifyReply & {
      clearCookie: (name: string, opts: Record<string, unknown>) => void;
    };
    // Match the Domain the cookies were set with (see setAuthCookies), otherwise
    // the prod `.${DOMAIN}`-scoped cookies aren't removed on account deletion.
    const clearOptions = buildClearCookieOptions(
      this.config.get<string>('NODE_ENV'),
      this.cookieDomain(),
    );
    cookieReply.clearCookie('sb-access-token', clearOptions);
    cookieReply.clearCookie('sb-refresh-token', clearOptions);

    this.logger.log(`account deleted: user ${user.id} (${user.email})`);
    void reply.send({ ok: true, next: '/?account_deleted=1' });
  }

  // ── §7: public email + password account ────────────────────────────────

  /**
   * POST /auth/public-signup — create a Supabase auth.users row with
   * the supplied email + password. Email confirmation is required
   * before login can succeed (Supabase sends its built-in
   * confirmation template; copy/branding is dashboard-side, not code).
   */
  async publicSignup(
    email: string,
    password: string,
    accepted: { terms?: string; privacy?: string },
    context: AcceptanceContext = {},
  ): Promise<{ message: string }> {
    await this.assertPublicSignupsOpen();
    // Before the account exists, so a stale-policy client is turned away without
    // having created anything it would then have to be asked about.
    const versions = this.legal.assertCurrent(accepted);
    const validation = validatePassword(password);
    if (!validation.ok) {
      throw new BadRequestException({
        code: 'weak_password',
        failing: validation.failing,
      });
    }
    const normalized = email.trim().toLowerCase();

    const { data, error } = await this.supabase.service.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: false,
    });
    if (error) {
      // Already exists, weak password caught server-side, etc.
      // Stay vague to avoid email enumeration ("if the email is new
      // we'll send a confirmation link"); the UI shows the success
      // banner regardless of the underlying state.
      this.logger.warn(`public-signup failed for ${normalized}: ${error.message}`);
    }

    // Only when an account was actually created. An existing email takes the
    // error branch above and creates nothing, so there is no subject to record
    // an acceptance for — and writing one would leak that the email is taken.
    const createdUserId = data?.user?.id;
    if (createdUserId) {
      await this.legal.recordForUser(createdUserId, versions, context);
    }

    return {
      message: 'If this email is new, a confirmation link has been sent.',
    };
  }

  /**
   * The two switches that close a Fighter's sign-up: its own, then read-only mode
   * (operator ruling 341). The interceptor lets `auth/` through whole, for the sign-in.
   */
  private async assertPublicSignupsOpen(): Promise<void> {
    if (await isFlagEnabledDirect(this.supabase, 'disable_public_signups')) {
      // Not a plain 503: the filter replaces its code, which the sign-up screen reads.
      throw new OperationalUnavailableException({
        code: SIGNUPS_DISABLED_CODE,
        message: 'Public signups are temporarily disabled',
      });
    }
    await assertNotReadOnly(this.supabase);
  }

  /**
   * POST /auth/public-login — email + password authentication for the
   * public app. Same shape as the admin `passwordLogin` but skips the
   * `hasAdminAccess` check and surfaces an explicit
   * `email_not_confirmed` code instead of a generic 401 when the
   * Supabase user exists but hasn't confirmed their email yet.
   */
  async publicLogin(email: string, password: string, reply: FastifyReply): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const tokenResponse = await this.requestPasswordTokenForPublic(normalized, password);

    if (!tokenResponse.access_token || !tokenResponse.refresh_token || !tokenResponse.user?.id) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.setAuthCookies(
      reply,
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      tokenResponse.expires_in,
    );
    await this.tryAutolinkGlobalPerson(tokenResponse.user.id, normalized);
    void reply.send({ next: '/me' });
  }

  /**
   * POST /auth/public-password-reset — request a password-reset email.
   * Always returns 202 + a generic message so the response shape is
   * identical for unknown emails (no enumeration).
   */
  async publicPasswordReset(
    email: string,
    audience: 'login' | 'public_login' = 'public_login',
  ): Promise<{ message: string }> {
    const normalized = email.trim().toLowerCase();
    // The link opens the host that asked: an organizer who pressed "forgot
    // password" on admin.${DOMAIN} sets it there, not in the participant app.
    // Same helper the magic-link callbacks use, so there is one place that maps
    // an audience to a host and the host is never built from input.
    const resetPage = this.buildPostAuthRedirectUrl('/reset-password', audience);

    try {
      const { data, error } = await this.supabase.service.auth.admin.generateLink({
        type: 'recovery',
        email: normalized,
      });
      const magicLink = mailedLink(resetPage, data.properties);
      if (error || !magicLink) {
        this.logger.warn(`public-password-reset: link generation failed for ${normalized}`);
      } else {
        await this.mail.sendMagicLink({ to: normalized, magicLink, type: 'recovery' });
      }
    } catch (err) {
      this.logger.warn(
        `public-password-reset: unexpected error for ${normalized}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { message: 'If this email is registered, a reset link has been sent.' };
  }

  /**
   * POST /auth/public-password-reset-confirm — exchange the recovery
   * token for a session and update the password.
   */
  async publicPasswordResetConfirm(
    token: string,
    password: string,
    reply: FastifyReply,
  ): Promise<void> {
    const validation = validatePassword(password);
    if (!validation.ok) {
      throw new BadRequestException({
        code: 'weak_password',
        failing: validation.failing,
      });
    }

    // The reset page hands back the code of our own mailed link (`mailedLink`,
    // ruling 303), read from its `?token_hash=`.
    const { data, error } = await this.supabase.anon.auth.verifyOtp({
      token_hash: token,
      type: 'recovery',
    });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const { error: updateError } = await this.supabase.service.auth.admin.updateUserById(
      data.user.id,
      { password },
    );
    if (updateError) {
      throw new ServiceUnavailableException('Could not update password');
    }

    // The session of the code died with the password write (ruling 352).
    if (data.user.email) {
      await this.signInWithNewPassword(reply, data.user.id, data.user.email, password);
    }
    await this.tryAutolinkGlobalPerson(data.user.id, data.user.email ?? null);
    void reply.send({ next: '/me' });
  }

  /**
   * Variant of requestPasswordToken that distinguishes "email not
   * confirmed" (specific 403 code) from generic "invalid credentials"
   * (401), so the UI can route the user to "Check your inbox" instead
   * of "Wrong password."
   */
  private async requestPasswordTokenForPublic(
    email: string,
    password: string,
  ): Promise<GoTruePasswordTokenResponse> {
    const { ok, body } = await this.askPasswordToken(email, password);

    if (!ok) {
      const errorCode =
        body && typeof body === 'object'
          ? ((body as Record<string, unknown>)['error_code'] ??
            (body as Record<string, unknown>)['error'])
          : undefined;
      if (errorCode === 'email_not_confirmed') {
        throw new HttpException(
          { code: 'email_not_confirmed', message: 'Email not confirmed' },
          403,
        );
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    return body as GoTruePasswordTokenResponse;
  }

  // ── §3: self-service claim from /me ─────────────────────────────────────

  /**
   * Search unclaimed, reachable global_persons by name for the /me "Find your
   * profile" UI: any signed-in account (operator ruling 105). It names people
   * who agreed to nothing, so no email or date of birth, the country only when
   * the profile's privacy map allows it, and never an erased or merged profile,
   * nor one known only through entries hidden from the public (claim-search.ts).
   */
  async searchGlobalPersonsForClaim(
    request: FastifyRequest,
    rawQuery: string,
  ): Promise<GlobalPersonSearchResult[]> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');

    const query = rawQuery.trim();
    if (!query || query.length < 2) return [];
    const safe = sanitizePostgrestFilterValue(query);
    if (!safe) return [];

    const deps = { supabase: this.supabase, orgs: this.orgs };
    return (await searchClaimableProfiles(deps, safe)).map((r) => {
      const club = Array.isArray(r.clubs) ? (r.clubs[0]?.name ?? null) : (r.clubs?.name ?? null);
      return {
        id: r.id,
        slug: r.slug,
        display_name: r.display_name,
        given_name: r.given_name,
        family_name: r.family_name,
        country_code: isFieldPublic(r.public_visibility, 'nationality') ? r.country_code : null,
        hema_ratings_id: r.hema_ratings_id,
        club_label: club,
      };
    });
  }

  /**
   * A profile known only through entries hidden from the public answers a claim request like an
   * unknown one, and nothing is mailed (ruling 175, `publiclyKnownProfileIds`).
   */
  private async isPubliclyKnown(globalPersonId: string): Promise<boolean> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    return (await publiclyKnownProfileIds(deps, [globalPersonId])).has(globalPersonId);
  }

  /**
   * Request a claim on a global_persons row. Validates ownership
   * pre-conditions, then either mails a confirmation link to
   * `global_persons.email` (happy path) or 422s with a hint about
   * asking an organizer (Slice F will replace the 422 with a queue
   * insert).
   */
  async requestGlobalPersonClaim(
    request: FastifyRequest,
    globalPersonId: string,
  ): Promise<
    { status: 'confirmation_sent'; redactedEmail: string } | { status: 'pending_approval' }
  > {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');

    // An erased, deleted or merged profile answers as an unknown one (ruling 106).
    const { data: target, error: loadError } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .select('id, display_name, email, claimed_by_user_id, clubs(name)')
        .eq('id', globalPersonId),
    ).maybeSingle();
    if (loadError) {
      throw new ServiceUnavailableException('Could not load profile');
    }
    if (!target || !(await this.isPubliclyKnown(globalPersonId))) {
      throw new NotFoundException('Profile not found');
    }
    const row = target as {
      id: string;
      display_name: string;
      email: string | null;
      claimed_by_user_id: string | null;
      clubs: { name: string } | { name: string }[] | null;
    };
    if (row.claimed_by_user_id) {
      // Carries a `code` for the same reason `already_pending` does below: the
      // personal space tells these two refusals apart to pick which sentence to
      // show, and matching on the English message is not something a client can
      // do safely — the exception filter is free to reword it, and the reader
      // is a French-speaking competitor's browser either way.
      throw new BadRequestException({
        code: 'already_claimed',
        message: 'Profile is already claimed',
      });
    }
    if (!row.email) {
      // §8 organizer-approval queue: no email on file → queue the
      // request for human review instead of dead-ending the user.
      const { error: pendingError } = await this.supabase.service
        .from('global_person_claim_requests')
        .insert({
          user_id: user.id,
          global_person_id: row.id,
          status: 'pending',
        });
      if (pendingError) {
        // Most likely a partial-unique-index violation: same user
        // already has a pending request for this profile.
        if (/duplicate key|unique/i.test(pendingError.message)) {
          throw new BadRequestException({
            code: 'already_pending',
            message: 'You already have a pending request for this profile',
          });
        }
        throw new ServiceUnavailableException('Could not submit claim request');
      }
      this.logger.log(`claim-request queued: user ${user.id} → global_persons ${row.id}`);
      return { status: 'pending_approval' };
    }

    // Issue a one-time token for a single-use, 1-hour link. Only the hash is
    // stored: possession of the mailbox is this flow's whole security model,
    // so a readable token column would be equivalent to a readable inbox.
    const token = randomBytes(CLAIM_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error: tokenError } = await this.supabase.service
      .from('global_person_claim_tokens')
      .insert({
        token_hash: this.hashToken(token),
        user_id: user.id,
        global_person_id: row.id,
        expires_at: expiresAt,
      });
    if (tokenError) {
      this.logger.error(`global-person claim token insert failed: ${tokenError.message}`);
      throw new ServiceUnavailableException('Could not create claim token');
    }

    const confirmUrl = `${this.buildPostAuthRedirectUrl('/me/claim-confirm', 'public_login')}?token=${encodeURIComponent(token)}`;
    await this.mail.sendMagicLink({
      to: row.email,
      magicLink: confirmUrl,
      type: 'claim',
      displayName: row.display_name,
    });

    return {
      status: 'confirmation_sent',
      redactedEmail: redactEmail(row.email),
    };
  }

  /**
   * Finalize a claim from the confirmation link. The web-public
   * `/me/claim-confirm` page posts the token back here after the
   * user clicks the magic link in their inbox.
   */
  async confirmGlobalPersonClaim(
    request: FastifyRequest,
    token: string,
  ): Promise<{ status: 'claimed'; globalPersonId: string }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid session');

    const t = await this.loadLiveClaimToken(token);
    if (new Date(t.expires_at).getTime() < Date.now()) {
      // Best-effort cleanup; ignore errors.
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);
      throw new BadRequestException({
        code: 'expired_or_used',
        message: 'This confirmation link has expired or has already been used',
      });
    }
    if (t.user_id !== user.id) {
      throw new ForbiddenException({
        code: 'user_mismatch',
        message: 'This confirmation link was issued to a different account',
      });
    }

    // Race-guard: only set if still unclaimed, and still reachable.
    const { data: updated, error: updateError } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .update({ claimed_by_user_id: user.id, updated_at: new Date().toISOString() })
        .eq('id', t.global_person_id)
        .is('claimed_by_user_id', null),
    )
      .select('id')
      .maybeSingle();
    if (updateError) {
      throw new ServiceUnavailableException('Could not finalize claim');
    }
    if (!updated) {
      // Someone else claimed it in the racing window, or it was erased or
      // merged there; the second is read as the first (ruling 106).
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);
      throw new BadRequestException({
        code: 'already_claimed',
        message: 'Profile is already claimed',
      });
    }

    await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);

    await this.syncPersonsForClaimedGlobalPerson(user.id, t.global_person_id, user.email);

    this.logger.log(`global-person claim confirmed: user ${user.id} → ${t.global_person_id}`);

    return { status: 'claimed', globalPersonId: t.global_person_id };
  }

  /**
   * The claim link a confirmation names, looked up by hash. A link to an
   * erased, deleted or merged profile answers as an unknown link (ruling 106).
   */
  private async loadLiveClaimToken(
    token: string,
  ): Promise<{ id: string; user_id: string; global_person_id: string; expires_at: string }> {
    const { data, error } = await this.supabase.service
      .from('global_person_claim_tokens')
      .select(
        'id, user_id, global_person_id, expires_at, global_persons(deleted_at, merged_into_id, account_deleted_at)',
      )
      .eq('token_hash', this.hashToken(token))
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException('Could not load token');
    }
    const row = data as {
      id: string;
      user_id: string;
      global_person_id: string;
      expires_at: string;
      global_persons: unknown;
    } | null;
    if (!row || !isReachableEmbed(row.global_persons)) {
      throw new BadRequestException({
        code: 'expired_or_used',
        message: 'This confirmation link has expired or has already been used',
      });
    }
    return row;
  }

  /**
   * The token is high-entropy random, so a bare digest is enough — no salt,
   * and no constant-time compare, since the match is an indexed equality in
   * Postgres rather than a comparison here. Mirrors PersonEmailChangeService.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Whether the user may enter the admin app at all.
   *
   * ANY platform tier, not just super-admin. This is a LOGIN gate: leaving it
   * super-admin-exact would refuse a platform_viewer with no org membership
   * outright, making the whole tier unreachable — the feature would exist and
   * be invisible.
   *
   * A failed read throws (operator ruling 301): read as "no access", a database
   * fault told an organiser with the right password that the account has no
   * rights. The guards keep the fail-closed `resolvePlatformRole`.
   */
  private async hasAdminAccess(userId: string): Promise<boolean> {
    if ((await readPlatformRole(this.supabase, userId)) !== null) return true;

    // .limit(1), not .maybeSingle(): PostgREST answers PGRST116 when more than
    // one row matches, so a user who belongs to two or more organizations would
    // fail the read.
    const { data: memberships, error } = await this.supabase.service
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['owner', 'admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead'])
      .limit(1);
    if (error) throw new Error(`Clubs of ${userId} unreadable: ${error.message}`);
    if (Array.isArray(memberships) && memberships.length > 0) return true;

    return this.readLeagueGrant(userId);
  }

  /**
   * A direct league grant is a first-class organizer credential. Leagues can be
   * administered by an individual account that belongs to no organization, and
   * assertCanManageLeague already authorizes those users on every
   * /admin/leagues/* endpoint — so login must not be the thing that blocks them.
   *
   * This widens no API capability: it only issues a session cookie for access
   * the API already permits. Their workspace is /leagues in web-admin.
   *
   * A failed read throws: neither `/me` (ruling 295) nor the sign-in door
   * (ruling 301) answers it as "none".
   */
  private async readLeagueGrant(userId: string): Promise<boolean> {
    // .limit(1), not .maybeSingle(): a user granted a role on two leagues
    // matches two rows, which PostgREST nulls — locking out exactly the users
    // this check exists to admit.
    const { data, error } = await this.supabase.service
      .from('league_user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'owner'])
      .limit(1);
    if (error) throw new Error(`League grant of ${userId} unreadable: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * What `/me` tells the admin site she may open. Both reads DECIDE: read as "no
   * role, no club", a database fault sent an organiser to the sign-in page. A
   * failed one throws (operator ruling 295). The admin shells keep her page on an
   * unreadable `/me`, and the landing pages say they could not check (295a).
   */
  private async getAdminLandingContext(userId: string): Promise<AdminLandingContext> {
    const platformRole = await readPlatformRole(this.supabase, userId);

    const { data, error } = await this.supabase.service
      .from('organization_members')
      .select('role, organizations(id, slug, name)')
      .eq('user_id', userId);
    if (error) throw new Error(`Clubs of ${userId} unreadable: ${error.message}`);

    const organizations = ((data ?? []) as unknown[])
      .map((row) => normalizeOrganizationMembership(row))
      .filter((row): row is AdminLandingContext['organizations'][number] => Boolean(row));
    return { platformRole, organizations };
  }

  /**
   * The account's own profile, for the header: its photo and its name (operator
   * ruling 298). It only decorates, so a failed read hands nothing and leaves a
   * warning (ruling 295).
   */
  private async readOwnProfile(userId: string): Promise<{ photoUrl?: string; name?: string }> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('photo_url, display_name')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `/me: the profile of ${userId} is unreadable (${error.message}); no name, no photo`,
      );
      return {};
    }
    const profile = data as { photo_url?: string | null; display_name?: string | null } | null;
    return {
      photoUrl: profile?.photo_url || undefined,
      name: profile?.display_name || undefined,
    };
  }

  private async requestAuthUser(accessToken: string) {
    return this.supabase.getAuthUser(accessToken);
  }

  private async requestPasswordToken(
    email: string,
    password: string,
  ): Promise<GoTruePasswordTokenResponse> {
    const { ok, body } = await this.askPasswordToken(email, password);
    if (!ok || !body || typeof body !== 'object') {
      throw new UnauthorizedException('Invalid email or password');
    }
    return body as GoTruePasswordTokenResponse;
  }

  /**
   * The current password of a signed-in account, asked again before a change of
   * password or an account deletion (operator ruling 329).
   *
   * A refusal is a 403 with its own code. The caller IS signed in, so a 401 at
   * those doors means the session ended: the client renews the login and sends
   * the request again, which a wrong password must not do (two tries spent).
   */
  private async confirmCurrentPassword(
    userId: string,
    email: string,
    currentPassword: string,
  ): Promise<void> {
    const { ok, body } = await this.askPasswordToken(email, currentPassword);
    const holder = ok ? (body as GoTruePasswordTokenResponse | null)?.user?.id : undefined;
    if (holder !== userId) {
      throw new ForbiddenException({
        code: WRONG_CURRENT_PASSWORD_CODE,
        message: 'Current password is incorrect',
      });
    }
  }

  /**
   * The ONE call to the auth server's password door, for the admin sign-in and
   * for the participant app (sign-in, password change, account deletion).
   *
   * The two sign-in screens read their door's 401 as a wrong password (operator
   * ruling 309); the security page reads the 403 of `confirmCurrentPassword`.
   * A silent, throttled or failing auth server has not judged the password: that
   * is a server error, never the 401.
   */
  private async askPasswordToken(
    email: string,
    password: string,
  ): Promise<{ ok: boolean; body: unknown }> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      throw new Error(`The auth server did not answer the password sign-in: ${String(err)}`, {
        cause: err,
      });
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`The auth server answered ${response.status} to the password sign-in`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, body };
  }

  /**
   * The login an account keeps after its password was written (operator ruling 352).
   *
   * The auth server ends EVERY session of an account whose password an admin call
   * writes, the caller's own too (read on GoTrue v2.195.0). So the door signs the
   * account in again with the password it just wrote. The password stands whatever
   * this sign-in answers: with no login from it the door still answers, hands out no
   * cookie, and the account signs in by hand.
   */
  private async signInWithNewPassword(
    reply: FastifyReply,
    userId: string,
    email: string,
    password: string,
  ): Promise<void> {
    try {
      const { body } = await this.askPasswordToken(email, password);
      const login = body as GoTruePasswordTokenResponse | null;
      if (login?.access_token && login.refresh_token) {
        this.setAuthCookies(reply, login.access_token, login.refresh_token, login.expires_in);
        return;
      }
      this.logger.warn(`new password of ${userId}: the auth server gave no login for it`);
    } catch (err) {
      this.logger.warn(`new password of ${userId}: no login for it (${String(err)})`);
    }
  }

  /**
   * Parent-domain scope (e.g. `.myclash.fr`) for the auth cookies in production,
   * so a login (incl. email-link callbacks that set the cookie on `api.` and
   * then redirect to `admin.`/`app.`) stays authenticated across subdomains.
   * Host-only (undefined) in dev to avoid breaking bare-localhost setups; can be
   * overridden via SESSION_COOKIE_DOMAIN.
   */
  private cookieDomain(): string | undefined {
    const explicit = this.config.get<string>('SESSION_COOKIE_DOMAIN');
    if (explicit) return explicit;
    if (!isProductionEnvironment(this.config.get<string>('NODE_ENV'))) return undefined;
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    return `.${domain}`;
  }

  private setAuthCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    _expiresIn = SESSION_MAX_AGE_SECONDS,
  ): void {
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };
    const env = this.config.get<string>('NODE_ENV');
    const domain = this.cookieDomain();

    cookieReply.setCookie(
      'sb-access-token',
      accessToken,
      buildSessionCookieOptions({ env, maxAge: SESSION_MAX_AGE_SECONDS, domain }),
    );

    cookieReply.setCookie(
      'sb-refresh-token',
      refreshToken,
      buildSessionCookieOptions({ env, maxAge: SESSION_MAX_AGE_SECONDS, domain }),
    );
  }

  private buildPostAuthRedirectUrl(path: string, type: string): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const protocol = domain.includes('localhost') ? 'https' : 'https';
    const base =
      type === 'login'
        ? `${protocol}://admin.${domain}`
        : type === 'public_login' || type === 'claim'
          ? `${protocol}://app.${domain}`
          : `${protocol}://${domain}`;

    return `${base}${path}`;
  }

  private extractToken(request: FastifyRequest): string | null {
    // Check Authorization header first
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    // Fall back to cookie
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return cookies?.['sb-access-token'] ?? null;
  }
}
