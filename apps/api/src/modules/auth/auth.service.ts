import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { MailService } from '../mail/mail.service';
import { OnboardingService } from '../organizations/onboarding.service';
import { buildClearCookieOptions, buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import type { MeResponseDto } from './dto/me-response.dto';
import type { OAuthSessionDto } from './dto/oauth-session.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';
import type { PersonalSpaceResponseDto } from './dto/personal-space-response.dto';
import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { GuestJwtService } from './guest-jwt.service';

/** Allowed redirect paths after auth — prevents open-redirect attacks. */
const ALLOWED_REDIRECT_PREFIXES = ['/org/', '/admin/', '/e/', '/me', '/dashboard', '/'];
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60;

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

  async acceptOAuthSession(dto: OAuthSessionDto, reply: FastifyReply): Promise<void> {
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
      await this.onboarding.completeSignupAfterMagicLink(user.id, dto.orgName, dto.orgSlug);
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

    try {
      const { data } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();
      if (data) return; // super admin bypasses lockdown
    } catch {
      // platform_roles missing in early bootstrap — fall through to block
    }

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
    const clearOptions = buildClearCookieOptions(this.config.get<string>('NODE_ENV'));

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

    // ── Claimed path ──────────────────────────────────────────────────────
    if (accessToken) {
      const user = await this.requestAuthUser(accessToken);

      if (user) {
        // Both claimed + guest present → claimed wins, clear guest cookie
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

        return {
          type: 'claimed',
          user: {
            id: user.id,
            email: user.email ?? '',
            display_name: user.user_metadata?.['display_name'] as string | undefined,
          },
          person,
          admin,
        };
      }
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

  async getPersonalSpace(request: FastifyRequest): Promise<PersonalSpaceResponseDto> {
    const accessToken = this.extractToken(request);
    if (!accessToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.requestAuthUser(accessToken);
    if (!user) {
      throw new UnauthorizedException('Invalid session');
    }

    const [claimedPersons, globalPerson, refereeAssignments, workshopEnrollments] =
      await Promise.all([
        this.fetchClaimedPersons(user.id),
        this.fetchGlobalPerson(user.id),
        this.fetchRefereeAssignments(user.id),
        this.fetchWorkshopEnrollments(user.id),
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
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async fetchClaimedPersons(userId: string): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select(
          'id, given_name, family_name, email, roles, event_id, global_person_id, claim_status, events(id, slug, name, start_date, end_date, status)',
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
          'id, slug, display_name, given_name, family_name, country_code, date_of_birth, is_fighter, is_referee, is_workshop_participant',
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
      await this.supabase.service
        .from('persons')
        .update({
          claim_status: 'claimed',
          claimed_by_user_id: userId,
        })
        .eq('id', personId);
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
      if (candidatesError || !Array.isArray(candidates) || candidates.length !== 1) return;

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
        return;
      }

      this.logger.log(`autolink: user ${userId} linked to global_persons ${target.id}`);
    } catch (err) {
      // Column or table missing pre-migration — silent no-op so login still works.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`autolink skipped (likely pre-migration): ${message}`);
    }
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
  ): Promise<{ status: 'confirmation_sent'; redactedEmail: string }> {
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
      // Slice F will replace this with a pending-request insert.
      throw new BadRequestException('profile_has_no_email');
    }

    // Issue a one-time token. UUID is opaque enough for a single-use,
    // 1-hour link; consistent with §3e schema.
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error: tokenError } = await this.supabase.service
      .from('global_person_claim_tokens')
      .insert({
        token,
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
      .select('token, user_id, global_person_id, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (loadError) {
      throw new ServiceUnavailableException('Could not load token');
    }
    if (!tokenRow) {
      throw new BadRequestException('expired_or_used');
    }
    const t = tokenRow as {
      token: string;
      user_id: string;
      global_person_id: string;
      expires_at: string;
    };
    if (new Date(t.expires_at).getTime() < Date.now()) {
      // Best-effort cleanup; ignore errors.
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('token', t.token);
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
      await this.supabase.service.from('global_person_claim_tokens').delete().eq('token', t.token);
      throw new BadRequestException('already_claimed');
    }

    await this.supabase.service.from('global_person_claim_tokens').delete().eq('token', t.token);

    this.logger.log(`global-person claim confirmed: user ${user.id} → ${t.global_person_id}`);

    return { status: 'claimed', globalPersonId: t.global_person_id };
  }

  private async hasAdminAccess(userId: string): Promise<boolean> {
    try {
      const { data: platformRole } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();

      if (platformRole) return true;
    } catch {
      // Table may not exist during early bootstrap.
    }

    try {
      const { data: membership } = await this.supabase.service
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['owner', 'admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead'])
        .maybeSingle();

      return Boolean(membership);
    } catch {
      return false;
    }
  }

  private async getAdminLandingContext(userId: string): Promise<AdminLandingContext> {
    let isSuperAdmin = false;
    let organizations: AdminLandingContext['organizations'] = [];

    try {
      const { data: platformRole } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();

      isSuperAdmin = Boolean(platformRole);
    } catch {
      // Table may not exist during early bootstrap.
    }

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

  private setAuthCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    _expiresIn = ADMIN_SESSION_MAX_AGE_SECONDS,
  ): void {
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };

    cookieReply.setCookie(
      'sb-access-token',
      accessToken,
      buildSessionCookieOptions({
        env: this.config.get<string>('NODE_ENV'),
        maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
      }),
    );

    cookieReply.setCookie(
      'sb-refresh-token',
      refreshToken,
      buildSessionCookieOptions({
        env: this.config.get<string>('NODE_ENV'),
        maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
      }),
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
