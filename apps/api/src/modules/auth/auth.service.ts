import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MailService } from '../mail/mail.service';
import { OnboardingService } from '../organizations/onboarding.service';
import { buildClearCookieOptions, buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import type { MeResponseDto } from './dto/me-response.dto';
import type { OAuthSessionDto } from './dto/oauth-session.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';
import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { GuestJwtService } from './guest-jwt.service';

/** Allowed redirect paths after auth — prevents open-redirect attacks. */
const ALLOWED_REDIRECT_PREFIXES = ['/org/', '/admin/', '/e/', '/dashboard', '/'];

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
      type,
    });

    return { message: 'If this email is registered, a link has been sent.' };
  }

  // ── Magic link callback ─────────────────────────────────────────────────

  async acceptOAuthSession(dto: OAuthSessionDto, reply: FastifyReply): Promise<void> {
    const {
      data: { user },
      error,
    } = await this.supabase.anon.auth.getUser(dto.accessToken);

    if (error || !user) {
      throw new UnauthorizedException('Invalid OAuth session');
    }

    let destination = this.validateRedirect(dto.next);

    if (dto.mode === 'admin_login') {
      const allowed = await this.hasAdminAccess(user.id);
      if (!allowed) {
        throw new ForbiddenException('No organizer or super admin access for this account');
      }
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

    this.setAuthCookies(reply, dto.accessToken, dto.refreshToken);
    void reply.send({ next: destination });
  }

  async passwordLogin(dto: PasswordLoginDto, reply: FastifyReply): Promise<void> {
    const destination = this.validateRedirect(dto.redirectTo);
    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const allowed = await this.hasAdminAccess(data.user.id);
    if (!allowed) {
      throw new ForbiddenException('No organizer or super admin access for this account');
    }

    this.setAuthCookies(
      reply,
      data.session.access_token,
      data.session.refresh_token ?? '',
      data.session.expires_in,
    );
    void reply.send({ next: destination === '/' ? '/dashboard' : destination });
  }

  async handleCallback(
    token: string,
    type: string,
    personId: string | undefined,
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

    // Redirect to appropriate destination
    const destination = type === 'claim' ? '/' : '/dashboard';
    void reply.redirect(destination);
  }

  // ── /me endpoint ────────────────────────────────────────────────────────

  async getMe(request: FastifyRequest, reply?: FastifyReply): Promise<MeResponseDto> {
    const accessToken = this.extractToken(request);
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const guestToken = cookies?.['mc_guest'];

    // ── Claimed path ──────────────────────────────────────────────────────
    if (accessToken) {
      const {
        data: { user },
        error,
      } = await this.supabase.anon.auth.getUser(accessToken);

      if (!error && user) {
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

        return {
          type: 'claimed',
          user: {
            id: user.id,
            email: user.email ?? '',
            display_name: user.user_metadata?.['display_name'] as string | undefined,
          },
          person,
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

  // ── Private helpers ─────────────────────────────────────────────────────

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
      // Table not yet created — skip
      this.logger.warn(
        `Could not update claim_status for person ${personId} — persons table not yet created`,
      );
    }
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

  private validateRedirect(redirectTo: string | undefined): string {
    if (!redirectTo) return '/';
    const isAllowed = ALLOWED_REDIRECT_PREFIXES.some((prefix) => redirectTo.startsWith(prefix));
    return isAllowed ? redirectTo : '/';
  }

  private setAuthCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    expiresIn = 3600,
  ): void {
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };

    cookieReply.setCookie(
      'sb-access-token',
      accessToken,
      buildSessionCookieOptions({
        env: this.config.get<string>('NODE_ENV'),
        maxAge: expiresIn,
      }),
    );

    cookieReply.setCookie(
      'sb-refresh-token',
      refreshToken,
      buildSessionCookieOptions({
        env: this.config.get<string>('NODE_ENV'),
        maxAge: 60 * 60 * 24 * 30,
      }),
    );
  }

  private buildRedirectUrl(path: string, type: string, personId: string | undefined): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const protocol = domain.includes('localhost') ? 'https' : 'https';
    const base = type === 'claim' ? `${protocol}://${domain}` : `${protocol}://admin.${domain}`;

    const callbackPath = `/api/v1/auth/callback?type=${type}${personId ? `&personId=${personId}` : ''}&next=${encodeURIComponent(path)}`;
    return `${base}${callbackPath}`;
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
