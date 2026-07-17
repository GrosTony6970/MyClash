import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { buildClearCookieOptions, buildSessionCookieOptions } from '../../security/http-security';
import { Public } from '../../common/auth/public.decorator';
import { GuestJwtService } from './guest-jwt.service';

const createGuestSessionSchema = z
  .object({
    person_id: z.uuid(),
  })
  .strict();
class CreateGuestSessionDto extends createZodDto(createGuestSessionSchema) {}

const COOKIE_NAME = 'mc_guest';

@ApiTags('auth')
@Controller()
export class GuestSessionsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly guestJwt: GuestJwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/v1/events/:eventId/guest-sessions
   *
   * Participant picks themselves from the roster. Creates a guest_sessions row,
   * signs a JWT with MYCLASH_GUEST_JWT_SECRET, sets mc_guest httpOnly cookie.
   *
   * Returns: { person, session }
   */
  // The caller has no identity yet — this route is how a guest gets one.
  // (DELETE guest-sessions/me is deliberately NOT public: it needs the mc_guest
  // cookie, which the guard resolves to a guest identity.)
  @Public()
  @Post('events/:eventId/guest-sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a guest session (participant picks themselves)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Guest session created, cookie set' })
  @ApiResponse({ status: 404, description: 'Person not found in this event' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateGuestSessionDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // 1. Verify person belongs to this event
    const { data: person, error: personError } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, claim_status, event_id')
      .eq('id', dto.person_id)
      .eq('event_id', eventId)
      .maybeSingle();

    if (personError || !person) {
      throw new UnauthorizedException('Person not found in this event');
    }

    // 2. Fetch event end_date to compute session expiry
    const { data: event } = await this.supabase.service
      .from('events')
      .select('end_date')
      .eq('id', eventId)
      .maybeSingle();

    const endDate = event ? new Date((event as { end_date: string }).end_date) : new Date();
    const expiresAt = new Date(endDate.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days

    // 3. Detect device label from User-Agent
    const ua = req.headers['user-agent'] ?? 'Unknown device';
    const deviceLabel = this.parseDeviceLabel(ua);

    // 4. Create guest_sessions row
    const { data: session, error: sessionError } = await this.supabase.service
      .from('guest_sessions')
      .insert({
        person_id: dto.person_id,
        device_label: deviceLabel,
        ip_first_seen: req.ip ?? null,
        user_agent: ua.slice(0, 500),
        expires_at: expiresAt.toISOString(),
      })
      .select('id, device_label, expires_at')
      .single();

    if (sessionError || !session) {
      throw new UnauthorizedException('Failed to create guest session');
    }

    const s = session as { id: string; device_label: string; expires_at: string };

    // 5. Sign JWT
    const token = this.guestJwt.sign(
      { sub: s.id, person_id: dto.person_id, event_id: eventId, type: 'guest' },
      expiresAt,
    );

    // 6. Set httpOnly cookie
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };
    cookieReply.setCookie(
      COOKIE_NAME,
      token,
      buildSessionCookieOptions({
        env: this.config.get<string>('NODE_ENV'),
        expires: expiresAt,
      }),
    );

    const p = person as {
      id: string;
      given_name: string;
      family_name: string;
      email: string;
      claim_status: string;
    };

    void reply.status(201).send({
      person: {
        id: p.id,
        given_name: p.given_name,
        family_name: p.family_name,
        claim_status: p.claim_status,
      },
      session: {
        id: s.id,
        device_label: s.device_label,
        expires_at: s.expires_at,
      },
    });
  }

  /**
   * DELETE /api/v1/guest-sessions/me
   *
   * Revoke the current guest session (explicit logout for this device).
   * Sets revoked_at on the DB row and clears the cookie.
   */
  @Delete('guest-sessions/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke current guest session (logout)' })
  @ApiResponse({ status: 204, description: 'Session revoked, cookie cleared' })
  async revoke(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[COOKIE_NAME];

    if (token) {
      try {
        const payload = this.guestJwt.verify(token);
        await this.supabase.service
          .from('guest_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', payload.sub);
      } catch {
        // Token invalid — still clear the cookie
      }
    }

    const cookieReply = reply as FastifyReply & {
      clearCookie: (name: string, opts: Record<string, unknown>) => void;
    };
    cookieReply.clearCookie(
      COOKIE_NAME,
      buildClearCookieOptions(this.config.get<string>('NODE_ENV')),
    );
    void reply.status(204).send();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private parseDeviceLabel(ua: string): string {
    if (/iPhone/i.test(ua)) return 'iPhone (Safari)';
    if (/iPad/i.test(ua)) return 'iPad (Safari)';
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 'Android Phone';
    if (/Android/i.test(ua)) return 'Android Tablet';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown device';
  }
}
