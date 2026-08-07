import { createHash, randomBytes } from 'node:crypto';
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
import { validatePassword } from '@myclash/types';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { hasPlatformTier } from '../../common/auth/platform-role';
import { MailService } from '../mail/mail.service';
import { OnboardingService } from '../organizations/onboarding.service';
// Value import, not `import type`: Nest reads the constructor's design:paramtypes
// metadata to inject it, and a type-only import erases that at compile time.
import { ErasureService } from '../privacy/erasure.service';
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
import { personEmailMatchesUser } from './person-email-match';
import type { MeResponseDto } from './dto/me-response.dto';
import type { OAuthSessionDto } from './dto/oauth-session.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';
import type { PersonalSpaceResponseDto } from './dto/personal-space-response.dto';
import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { GuestJwtService } from './guest-jwt.service';

/** Allowed redirect paths after auth — prevents open-redirect attacks. */
const ALLOWED_REDIRECT_PREFIXES = ['/org/', '/admin/', '/e/', '/me', '/dashboard', '/'];
// Sliding-session lifetime for the auth cookies (30 days). The access token's
// own JWT exp (GOTRUE_JWT_EXP, ~1h) still governs validity; when it expires,
// `getMe` mints a fresh one from the refresh-token cookie and re-sets both
// cookies. This long maxAge just keeps the cookies on disk so that renewal can
// happen — previously both cookies were capped at 1h with no refresh, so every
// session hard-expired after an hour.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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

  const orgRecord = organization as { id?: unknown; slug?: unknown };
  if (
    typeof record.role !== 'string' ||
    typeof orgRecord.id !== 'string' ||
    typeof orgRecord.slug !== 'string'
  ) {
    return null;
  }

  return {
    id: orgRecord.id,
    slug: orgRecord.slug,
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
    private readonly guestJwt?: GuestJwtService,
    private readonly onboarding?: OnboardingService,
  ) {}

  // ── Magic link request ──────────────────────────────────────────────────

  async requestMagicLink(dto: RequestMagicLinkDto): Promise<{ message: string }> {
    const { email, type, personId, redirectTo } = dto;

    // Validate redirect path (prevent open redirect)
    const safeRedirect = this.validateRedirect(redirectTo);

    if (type === 'claim') {
      if (!personId) {
        throw new BadRequestException('personId is required for claim type');
      }
      await this.validatePersonClaim(personId, email);
    }

    // Generate magic link via Supabase Auth (GoTrue)
    const { data, error } = await this.supabase.service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: this.buildRedirectUrl(safeRedirect, type, personId),
      },
    });

    if (error || !data.properties?.action_link) {
      this.logger.error(`Failed to generate magic link for ${email}: ${error?.message}`);
      // Return generic message to prevent email enumeration
      return { message: 'If this email is registered, a link has been sent.' };
    }

    await this.mail.sendMagicLink({
      to: email,
      magicLink: data.properties.action_link,
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

    let destination = this.validateRedirect(dto.next);

    if (dto.mode === 'admin_login') {
      const allowed = await this.hasAdminAccess(user.id);
      if (!allowed) {
        throw new ForbiddenException('No organizer or super admin access for this account');
      }
      await this.assertNotLockedOut(user.id);
      destination = destination === '/' ? '/dashboard' : destination;
    }

    if (dto.mode === 'organizer_signup') {
      if (!dto.orgName?.trim() || !dto.orgSlug?.trim()) {
        throw new BadRequestException('Organization name and slug are required');
      }
      if (!this.onboarding) {
        throw new BadRequestException('Organizer signup is not available');
      }
      // Checked before the org is created: a signup that fails the policy check
      // must not leave a half-made organisation behind.
      const versions = this.legal.assertCurrent({
        terms: dto.acceptedTerms,
        privacy: dto.acceptedPrivacy,
      });
      await this.onboarding.completeSignupAfterMagicLink(user.id, dto.orgName, dto.orgSlug);
      await this.legal.recordForUser(user.id, versions, context);
      destination = destination === '/' ? `/org/${dto.orgSlug}` : destination;
    }

    if (dto.mode === 'person_claim') {
      if (!dto.personId) {
        throw new BadRequestException('personId is required for person claim');
      }
      if (!user.email) {
        throw new ForbiddenException('Google account did not provide an email address');
      }
      await this.validatePersonClaim(dto.personId, user.email, true);
      await this.completeClaim(user.id, dto.personId);
    }

    if (dto.mode === 'public_login') {
      destination = destination === '/' ? '/me' : destination;
    }

    this.setAuthCookies(reply, dto.accessToken, dto.refreshToken);
    await this.tryAutolinkGlobalPerson(user.id, user.email ?? null);
    void reply.send({ next: destination });
  }

  async passwordLogin(dto: PasswordLoginDto, reply: FastifyReply): Promise<void> {
    const destination = this.validateRedirect(dto.redirectTo);
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

    // super admin bypasses lockdown
    if (await hasPlatformTier(this.supabase, userId, 'super_admin')) return;

    throw new ServiceUnavailableException(
      'MyClash admin is temporarily restricted to super admins. Please try again later.',
    );
  }

  private async isAdminLockdownEnabled(): Promise<boolean> {
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

  async handleCallback(
    token: string,
    type: string,
    personId: string | undefined,
    next: string | undefined,
    reply: FastifyReply,
  ): Promise<void> {
    // Exchange the OTP token for a session
    const { data, error } = await this.supabase.anon.auth.verifyOtp({
      token_hash: token,
      type: 'magiclink',
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

    // If this was a claim, update the person's claim_status
    if (type === 'claim' && personId) {
      await this.completeClaim(session.user.id, personId);
    }

    // Silent autolink to a matching global profile on any login path
    // (login / public_login / claim — all benefit).
    await this.tryAutolinkGlobalPerson(session.user.id, session.user.email ?? null);

    // Redirect to appropriate destination
    const safeRedirect = this.validateRedirect(next);
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
    const destination = this.buildPostAuthRedirectUrl(path, type);
    void reply.redirect(destination);
  }

  // ── /me endpoint ────────────────────────────────────────────────────────

  async getMe(request: FastifyRequest, reply?: FastifyReply): Promise<MeResponseDto> {
    const accessToken = this.extractToken(request);
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const guestToken = cookies?.['mc_guest'];
    const refreshToken = cookies?.['sb-refresh-token'];

    // ── Claimed path ──────────────────────────────────────────────────────
    let user = accessToken ? await this.requestAuthUser(accessToken) : null;

    // Access token missing or expired → mint a fresh one from the refresh-token
    // cookie (sliding session). Needs `reply` so the rotated cookies can be
    // written back; without it (e.g. a read-only call) we just stay anonymous.
    if (!user && refreshToken && reply) {
      const refreshed = await this.supabase.refreshSession(refreshToken);
      if (refreshed) {
        this.setAuthCookies(
          reply,
          refreshed.access_token,
          refreshed.refresh_token,
          refreshed.expires_in,
        );
        user = await this.requestAuthUser(refreshed.access_token);
      }
    }

    if (user) {
      return this.buildClaimedResponse(user, guestToken, reply);
    }

    // ── Guest path ────────────────────────────────────────────────────────
    if (guestToken && this.guestJwt) {
      try {
        const payload = this.guestJwt.verify(guestToken);

        // Fetch session + person from DB
        const { data: sessionData } = await this.supabase.service
          .from('guest_sessions')
          .select('id, device_label, expires_at, revoked_at')
          .eq('id', payload.sub)
          .maybeSingle();

        if (sessionData) {
          const s = sessionData as {
            id: string;
            device_label: string;
            expires_at: string;
            revoked_at: string | null;
          };

          // Revoked sessions are treated as anonymous
          if (s.revoked_at) {
            return { type: 'anonymous' };
          }

          const { data: personData } = await this.supabase.service
            .from('persons')
            .select('id, given_name, family_name, event_id, claim_status')
            .eq('id', payload.person_id)
            .maybeSingle();

          return {
            type: 'guest',
            person: personData as MeResponseDto['person'] | undefined,
            session: {
              device_label: s.device_label,
              expires_at: s.expires_at,
            },
          };
        }
      } catch {
        // Invalid/expired guest token — fall through to anonymous
      }
    }

    // ── Anonymous ─────────────────────────────────────────────────────────
    return { type: 'anonymous' };
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

    let person: MeResponseDto['person'] | undefined;
    try {
      const { data: personData } = await this.supabase.service
        .from('persons')
        .select('id, given_name, family_name, event_id, claim_status')
        .eq('claimed_by_user_id', user.id)
        .maybeSingle();

      if (personData) {
        person = personData as MeResponseDto['person'];
      }
    } catch {
      // Table doesn't exist yet (pre-T-101) — ignore
    }

    const admin = await this.getAdminLandingContext(user.id);

    // Global profile photo (avatar in the personal-space sidebar). Best-effort:
    // the user may not have a linked global_persons row yet. Kept last so it
    // doesn't shift the ordered query mocks in getMe tests.
    let photoUrl: string | undefined;
    try {
      const { data: globalPerson } = await this.supabase.service
        .from('global_persons')
        .select('photo_url')
        .eq('claimed_by_user_id', user.id)
        .maybeSingle();
      const url = (globalPerson as { photo_url?: string | null } | null)?.photo_url;
      if (url) photoUrl = url;
    } catch {
      // ignore — sidebar simply falls back to initials
    }

    // Gates the "My leagues" nav entry + the /dashboard league branch. Appended
    // after the photo query for the same reason it is kept last: inserting a
    // query earlier shifts the ordered mocks in the getMe tests. Deliberately a
    // cheap existence check rather than listManageable, whose count enrichment
    // pulls every league_rankings row into memory — far too heavy for /me.
    const hasLeagueRoles = await this.hasLeagueGrant(user.id);

    // Appended LAST, for the same reason the two queries above are: the getMe
    // tests drive ordered `mockReturnValueOnce` chains, and inserting a query
    // earlier silently hands every later one the wrong response. One indexed
    // lookup; it never throws (see LegalAcceptanceService.pendingFor).
    const pendingLegal = await this.legal.pendingFor(user.id);

    return {
      type: 'claimed',
      user: {
        id: user.id,
        email: user.email ?? '',
        display_name: user.user_metadata?.['display_name'] as string | undefined,
        photo_url: photoUrl,
      },
      person,
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

    const [claimedPersons, globalPerson, refereeAssignments, workshopEnrollments, claimable] =
      await Promise.all([
        this.fetchClaimedPersons(user.id),
        this.fetchGlobalPerson(user.id),
        this.fetchRefereeAssignments(user.id),
        this.fetchWorkshopEnrollments(user.id),
        this.fetchClaimablePersons(user.email),
      ]);

    const eventIds = new Set<string>();
    for (const person of claimedPersons) {
      const eventId = person['event_id'];
      if (typeof eventId === 'string') eventIds.add(eventId);
    }

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
   * skipped. Idempotent. Returns how many were claimed/owned.
   */
  async claimPersons(request: FastifyRequest, personIds: string[]): Promise<{ claimed: number }> {
    const accessToken = this.extractToken(request);
    if (!accessToken) throw new UnauthorizedException('Authentication required');
    const user = await this.requestAuthUser(accessToken);
    if (!user || !user.email) throw new UnauthorizedException('Invalid session');

    let claimed = 0;
    for (const personId of personIds) {
      const { data } = await this.supabase.service
        .from('persons')
        .select('id, email, claimed_by_user_id')
        .eq('id', personId)
        .maybeSingle();
      const person = data as {
        id: string;
        email: string | null;
        claimed_by_user_id: string | null;
      } | null;
      if (!person) continue;
      // Already owned by someone else → never reassign.
      if (person.claimed_by_user_id && person.claimed_by_user_id !== user.id) continue;
      if (!personEmailMatchesUser(person.email, user.email)) continue;
      await this.completeClaim(user.id, personId);
      claimed += 1;
    }
    return { claimed };
  }

  /**
   * Unclaimed roster profiles whose registered email matches the user's —
   * the confirm-step suggestions for the /me dashboard.
   */
  private async fetchClaimablePersons(
    email: string | null | undefined,
  ): Promise<Array<{ id: string; name: string; eventName: string }>> {
    const normalized = (email ?? '').trim();
    if (!normalized) return [];
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        // NO `roles` COLUMN EXISTS — on `persons` or on any other table. It
        // 400'd the query, the `if (error) return []` below swallowed it, and
        // the claim-your-profile suggestions were empty for every user who ever
        // had one. Same phantom column killed fetchClaimedPersons.
        .select('id, given_name, family_name, email, claimed_by_user_id, events(name)')
        .ilike('email', normalized)
        .is('claimed_by_user_id', null);
      if (error) return [];
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      return rows
        .filter((r) => personEmailMatchesUser(r['email'] as string | null, normalized))
        .map((r) => ({
          id: r['id'] as string,
          name: `${((r['given_name'] as string) ?? '').trim()} ${((r['family_name'] as string) ?? '').trim()}`.trim(),
          eventName: ((r['events'] as { name?: string } | null)?.name ?? '').trim(),
        }));
    } catch {
      return [];
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

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
          'id, event_id, role, created_at, events(id, slug, name), matches(id, phase_id, status, scheduled_at, ended_at)',
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

  private async validatePersonClaim(
    personId: string,
    email: string,
    strict = false,
  ): Promise<void> {
    // NOTE: persons table created in T-101. Until then, skip validation.
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select('id, email, claim_status')
        .eq('id', personId)
        .maybeSingle();

      if (error) {
        if (strict) throw new BadRequestException('Could not validate profile claim');
        return; // Table not yet created — skip
      }

      if (!data) {
        throw new NotFoundException('Person not found');
      }

      if ((data as { email: string }).email.toLowerCase() !== email.toLowerCase()) {
        throw new BadRequestException('Email does not match the registered person');
      }

      if ((data as { claim_status: string }).claim_status === 'claimed') {
        throw new BadRequestException('This profile has already been claimed');
      }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      if (strict) {
        throw new BadRequestException('Could not validate profile claim');
      }
      // Table not yet created — skip validation
    }
  }

  private async completeClaim(userId: string, personId: string): Promise<void> {
    try {
      const { error } = await this.supabase.service
        .from('persons')
        .update({
          claim_status: 'claimed',
          claimed_by_user_id: userId,
        })
        .eq('id', personId);
      if (error) throw error;

      await this.linkClaimedPersonGlobalProfile(userId, personId);
    } catch {
      this.logger.warn(
        `Could not update claim_status for person ${personId} — persons table not yet created`,
      );
    }

    // Post-0063: no referee-identity back-fill is needed. Referee tables
    // key on person_id (= global_persons.id), which is stable across the
    // unclaimed → claimed transition. Notification dispatch + "my schedule"
    // resolve the JWT user_id → person_id at request time via
    // global_persons.claimed_by_user_id.
  }

  /**
   * Propagate a global-person claim to every linked event participant row.
   *
   * The fighter dashboard reads `global_persons.claimed_by_user_id`, but the
   * admin Participants list reads `persons.claim_status`. The paths that link
   * a user to a global identity (autolink, magic-link self-service confirm,
   * admin approval) only ever set `global_persons.claimed_by_user_id`, leaving
   * the `persons` rows showing "unclaimed". This back-fills them.
   *
   * Keyed by `global_person_id` so ALL events the person appears in flip at
   * once. Guarded with `.is('claimed_by_user_id', null)` so we never overwrite
   * a row already owned by another user (and still flip unowned guest rows).
   * Best-effort: a failure (e.g. pre-migration schema) is logged, never thrown
   * — it must not block login or claim confirmation.
   */
  private async syncPersonsForClaimedGlobalPerson(
    userId: string,
    globalPersonId: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase.service
        .from('persons')
        .update({ claim_status: 'claimed', claimed_by_user_id: userId })
        .eq('global_person_id', globalPersonId)
        .is('claimed_by_user_id', null);
      if (error) throw error;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `persons claim-status sync skipped for global_persons ${globalPersonId}: ${message}`,
      );
    }
  }

  /**
   * Silent auto-link of an authenticated user to a matching global_persons
   * row by email. Runs at the tail of every successful login path.
   *
   * Rules:
   * - Skip if the user already has a linked global profile (idempotent).
   * - Match must be EXACTLY one unclaimed, unmerged row on LOWER(email).
   * - Zero or multiple matches → no-op (the user falls through to the
   *   manual /me search UI).
   *
   * Trust model: Supabase already verified the email during signup /
   * OAuth, so we trust the match without a second confirmation. The
   * link is reversible via the "Not me?" unlink endpoint.
   */
  async tryAutolinkGlobalPerson(userId: string, email: string | null | undefined): Promise<void> {
    if (!email || !email.trim()) return;
    const normalized = email.trim().toLowerCase();

    try {
      const { data: existing } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .eq('claimed_by_user_id', userId)
        .is('merged_into_id', null)
        .limit(1)
        .maybeSingle();
      if (existing) return;

      const { data: candidates, error: candidatesError } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .ilike('email', normalized)
        .is('claimed_by_user_id', null)
        .is('merged_into_id', null)
        .limit(2);
      if (candidatesError || !Array.isArray(candidates) || candidates.length !== 1) {
        await this.tryAutolinkClaimedPersonGlobalProfile(userId);
        return;
      }

      const target = candidates[0] as { id: string };
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
        await this.syncPersonsForClaimedGlobalPerson(userId, target.id);
        return;
      }

      await this.tryAutolinkClaimedPersonGlobalProfile(userId);
    } catch (err) {
      // Column or table missing pre-migration — silent no-op so login still works.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`autolink skipped (likely pre-migration): ${message}`);
    }
  }

  private async linkClaimedPersonGlobalProfile(userId: string, personId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();
    if (error || !data) return;

    const globalPersonId = (data as { global_person_id: string | null }).global_person_id;
    if (!globalPersonId) return;

    await this.linkGlobalPersonToUserIfSafe(userId, globalPersonId);
  }

  private async tryAutolinkClaimedPersonGlobalProfile(userId: string): Promise<void> {
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

    await this.linkGlobalPersonToUserIfSafe(userId, globalPersonId);
  }

  private async linkGlobalPersonToUserIfSafe(
    userId: string,
    globalPersonId: string,
  ): Promise<void> {
    const { data: existing } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .is('merged_into_id', null)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    const { data: target, error: targetError } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id, merged_into_id')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (targetError || !target) return;

    const row = target as {
      id: string;
      claimed_by_user_id: string | null;
      merged_into_id?: string | null;
    };
    if (row.merged_into_id || row.claimed_by_user_id) return;

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

    const identities = (user as { identities?: Array<{ provider?: string }> }).identities ?? [];
    const hasPassword = identities.some((i) => i.provider === 'email');
    return { hasPassword, email: user.email ?? null };
  }

  /**
   * Change the current user's password. Verifies the current
   * password by re-issuing a Supabase token (grant_type=password),
   * then updates via admin.updateUserById. Other sessions are
   * invalidated by Supabase as a side-effect of the password
   * update.
   */
  async changePassword(
    request: FastifyRequest,
    currentPassword: string,
    newPassword: string,
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
    const tokenResponse = await this.requestPasswordTokenForPublic(user.email, currentPassword);
    if (!tokenResponse.user?.id || tokenResponse.user.id !== user.id) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const { error: updateError } = await this.supabase.service.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) {
      throw new ServiceUnavailableException('Could not update password');
    }

    this.logger.log(`password changed for user ${user.id}`);
    return { ok: true };
  }

  /**
   * Delete the current user's account. Strips claim links from
   * global_persons + persons (history rows survive), removes
   * pending tokens/requests by the user, then deletes the
   * auth.users row via Supabase admin. Idempotent on the row-strip
   * step; the auth delete is the one-shot. Refuses for users
   * without a password identity (v1) with a hint to set a password
   * via the change-password flow first.
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

    const identities = (user as { identities?: Array<{ provider?: string }> }).identities ?? [];
    const hasPassword = identities.some((i) => i.provider === 'email');
    // Accounts WITH a password re-authenticate to confirm. Google-only accounts
    // (no password) delete on the authenticated session + typed confirmation
    // alone — they sign in through Google and have no password to verify.
    if (hasPassword) {
      const tokenResponse = await this.requestPasswordTokenForPublic(user.email, currentPassword);
      if (!tokenResponse.user?.id || tokenResponse.user.id !== user.id) {
        throw new UnauthorizedException('Current password is incorrect');
      }
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
    if (await isFlagEnabledDirect(this.supabase, 'disable_public_signups')) {
      throw new ServiceUnavailableException({
        code: 'signups_disabled',
        message: 'Public signups are temporarily disabled',
      });
    }
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
  async publicPasswordReset(email: string): Promise<{ message: string }> {
    const normalized = email.trim().toLowerCase();
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const redirectTo = `https://app.${domain}/reset-password`;

    try {
      const { data, error } = await this.supabase.service.auth.admin.generateLink({
        type: 'recovery',
        email: normalized,
        options: { redirectTo },
      });
      if (error || !data.properties?.action_link) {
        this.logger.warn(`public-password-reset: link generation failed for ${normalized}`);
      } else {
        await this.mail.sendMagicLink({
          to: normalized,
          magicLink: data.properties.action_link,
          type: 'login',
        });
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

    // Recovery tokens come back as `?code=…` Supabase PKCE codes
    // since the email flow goes through the new `verifyOtp` API.
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

    this.setAuthCookies(
      reply,
      data.session.access_token,
      data.session.refresh_token ?? '',
      data.session.expires_in,
    );
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
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new UnauthorizedException('Invalid email or password');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
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
   * Search unclaimed, unmerged global_persons by name/club for the /me
   * "Find your profile" UI. Never returns email or date_of_birth — those
   * fields would leak identity to anonymous probing.
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

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, slug, display_name, given_name, family_name, country_code, hema_ratings_id, clubs(name)',
      )
      .is('claimed_by_user_id', null)
      .is('merged_into_id', null)
      .or(`display_name.ilike.%${safe}%,given_name.ilike.%${safe}%,family_name.ilike.%${safe}%`)
      .order('display_name', { ascending: true })
      .limit(20);

    if (error) {
      this.logger.warn(`global-person search failed: ${error.message}`);
      return [];
    }

    return (data ?? []).map((row) => {
      const r = row as {
        id: string;
        slug: string;
        display_name: string;
        given_name: string;
        family_name: string;
        country_code: string | null;
        hema_ratings_id: string | null;
        clubs: { name: string } | { name: string }[] | null;
      };
      const club = Array.isArray(r.clubs) ? (r.clubs[0]?.name ?? null) : (r.clubs?.name ?? null);
      return {
        id: r.id,
        slug: r.slug,
        display_name: r.display_name,
        given_name: r.given_name,
        family_name: r.family_name,
        country_code: r.country_code,
        hema_ratings_id: r.hema_ratings_id,
        club_label: club,
      };
    });
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

    const { data: target, error: loadError } = await this.supabase.service
      .from('global_persons')
      .select('id, display_name, email, claimed_by_user_id, merged_into_id, clubs(name)')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (loadError) {
      throw new ServiceUnavailableException('Could not load profile');
    }
    if (!target) {
      throw new NotFoundException('Profile not found');
    }
    const row = target as {
      id: string;
      display_name: string;
      email: string | null;
      claimed_by_user_id: string | null;
      merged_into_id: string | null;
      clubs: { name: string } | { name: string }[] | null;
    };
    if (row.merged_into_id) {
      throw new BadRequestException('This profile has been merged');
    }
    if (row.claimed_by_user_id) {
      throw new BadRequestException('Profile is already claimed');
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

    const { data: tokenRow, error: loadError } = await this.supabase.service
      .from('global_person_claim_tokens')
      .select('id, user_id, global_person_id, expires_at')
      .eq('token_hash', this.hashToken(token))
      .maybeSingle();
    if (loadError) {
      throw new ServiceUnavailableException('Could not load token');
    }
    if (!tokenRow) {
      throw new BadRequestException('expired_or_used');
    }
    const t = tokenRow as {
      id: string;
      user_id: string;
      global_person_id: string;
      expires_at: string;
    };
    if (new Date(t.expires_at).getTime() < Date.now()) {
      // Best-effort cleanup; ignore errors.
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);
      throw new BadRequestException('expired_or_used');
    }
    if (t.user_id !== user.id) {
      throw new ForbiddenException('user_mismatch');
    }

    // Race-guard: only set if still unclaimed.
    const { data: updated, error: updateError } = await this.supabase.service
      .from('global_persons')
      .update({ claimed_by_user_id: user.id, updated_at: new Date().toISOString() })
      .eq('id', t.global_person_id)
      .is('claimed_by_user_id', null)
      .select('id')
      .maybeSingle();
    if (updateError) {
      throw new ServiceUnavailableException('Could not finalize claim');
    }
    if (!updated) {
      // Someone else already claimed in the racing window.
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);
      throw new BadRequestException('already_claimed');
    }

    await this.supabase.service.from('global_person_claim_tokens').delete().eq('id', t.id);

    await this.syncPersonsForClaimedGlobalPerson(user.id, t.global_person_id);

    this.logger.log(`global-person claim confirmed: user ${user.id} → ${t.global_person_id}`);

    return { status: 'claimed', globalPersonId: t.global_person_id };
  }

  /**
   * The token is high-entropy random, so a bare digest is enough — no salt,
   * and no constant-time compare, since the match is an indexed equality in
   * Postgres rather than a comparison here. Mirrors PersonEmailChangeService.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async hasAdminAccess(userId: string): Promise<boolean> {
    if (await hasPlatformTier(this.supabase, userId, 'super_admin')) return true;

    try {
      // .limit(1), not .maybeSingle(): PostgREST nulls `data` and returns
      // PGRST116 when more than one row matches, and this read ignores `error`.
      // A user who belongs to two or more organizations would therefore read as
      // having no membership at all and be denied login.
      const { data: memberships } = await this.supabase.service
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['owner', 'admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead'])
        .limit(1);

      if (Array.isArray(memberships) && memberships.length > 0) return true;
    } catch {
      // Table may not exist during early bootstrap.
    }

    return this.hasLeagueGrant(userId);
  }

  /**
   * A direct league grant is a first-class organizer credential. Leagues can be
   * administered by an individual account that belongs to no organization, and
   * assertCanManageLeague already authorizes those users on every
   * /admin/leagues/* endpoint — so login must not be the thing that blocks them.
   *
   * This widens no API capability: it only issues a session cookie for access
   * the API already permits. Their workspace is /leagues in web-admin.
   */
  private async hasLeagueGrant(userId: string): Promise<boolean> {
    try {
      // .limit(1), not .maybeSingle(): a user granted a role on two leagues
      // matches two rows, which PostgREST nulls — locking out exactly the users
      // this check exists to admit.
      const { data } = await this.supabase.service
        .from('league_user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['admin', 'owner'])
        .limit(1);

      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  }

  private async getAdminLandingContext(userId: string): Promise<AdminLandingContext> {
    let organizations: AdminLandingContext['organizations'] = [];

    const isSuperAdmin = await hasPlatformTier(this.supabase, userId, 'super_admin');

    try {
      const { data: membershipRows } = await this.supabase.service
        .from('organization_members')
        .select('role, organizations(id, slug)')
        .eq('user_id', userId);

      organizations = Array.isArray(membershipRows)
        ? membershipRows
            .map((row) => normalizeOrganizationMembership(row))
            .filter((row): row is AdminLandingContext['organizations'][number] => Boolean(row))
        : [];
    } catch {
      organizations = [];
    }

    return { isSuperAdmin, organizations };
  }

  private validateRedirect(redirectTo: string | undefined): string {
    if (!redirectTo) return '/';
    const isAllowed = ALLOWED_REDIRECT_PREFIXES.some((prefix) => redirectTo.startsWith(prefix));
    return isAllowed ? redirectTo : '/';
  }

  private async requestAuthUser(accessToken: string) {
    return this.supabase.getAuthUser(accessToken);
  }

  private async requestPasswordToken(
    email: string,
    password: string,
  ): Promise<GoTruePasswordTokenResponse> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: {
      ok: boolean;
      json: () => Promise<unknown>;
    };

    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new UnauthorizedException('Invalid email or password');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || !body || typeof body !== 'object') {
      throw new UnauthorizedException('Invalid email or password');
    }

    return body as GoTruePasswordTokenResponse;
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

  private buildRedirectUrl(path: string, type: string, personId: string | undefined): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const protocol = domain.includes('localhost') ? 'https' : 'https';
    const base = `${protocol}://api.${domain}`;

    const callbackPath = `/api/v1/auth/callback?type=${type}${personId ? `&personId=${personId}` : ''}&next=${encodeURIComponent(path)}`;
    return `${base}${callbackPath}`;
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
