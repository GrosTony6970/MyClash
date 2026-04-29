import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { MeResponseDto } from './dto/me-response.dto';
import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { GuestJwtService } from './guest-jwt.service';

/** Allowed redirect paths after auth — prevents open-redirect attacks. */
const ALLOWED_REDIRECT_PREFIXES = [
  '/org/',
  '/admin/',
  '/e/',
  '/dashboard',
  '/',
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly guestJwt?: GuestJwtService,
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

    // Set the Supabase session as a secure httpOnly cookie
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };
    cookieReply.setCookie('sb-access-token', session.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: session.expires_in,
    });

    cookieReply.setCookie('sb-refresh-token', session.refresh_token ?? '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

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
      const { data: { user }, error } = await this.supabase.anon.auth.getUser(accessToken);

      if (!error && user) {
        // Both claimed + guest present → claimed wins, clear guest cookie
        if (guestToken && reply) {
          const cookieReply = reply as FastifyReply & {
            clearCookie: (name: string, opts: Record<string, unknown>) => void;
          };
          cookieReply.clearCookie('mc_guest', { path: '/' });
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

  private async validatePersonClaim(personId: string, email: string): Promise<void> {
    // NOTE: persons table created in T-101. Until then, skip validation.
    try {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select('id, email, claim_status')
        .eq('id', personId)
        .maybeSingle();

      if (error) return; // Table not yet created — skip

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
      this.logger.warn(`Could not update claim_status for person ${personId} — persons table not yet created`);
    }
  }

  private validateRedirect(redirectTo: string | undefined): string {
    if (!redirectTo) return '/';
    const isAllowed = ALLOWED_REDIRECT_PREFIXES.some((prefix) =>
      redirectTo.startsWith(prefix),
    );
    return isAllowed ? redirectTo : '/';
  }

  private buildRedirectUrl(
    path: string,
    type: string,
    personId: string | undefined,
  ): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    const protocol = domain.includes('localhost') ? 'https' : 'https';
    const base = type === 'claim'
      ? `${protocol}://${domain}`
      : `${protocol}://admin.${domain}`;

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
