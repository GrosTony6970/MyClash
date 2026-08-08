import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { resolveEventId } from '../../common/event-ref';
import { Public } from '../../common/auth/public.decorator';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PassService } from './pass.service';

/**
 * The participant's half of the event pass — issuing one, and previewing one
 * that arrived by email.
 *
 * Separate from `CheckinController` because the audiences have nothing in
 * common: this is the fighter on their own phone, that is a volunteer holding an
 * `mc_staff` session. They share `PassService` and nothing else.
 */
@ApiTags('checkin')
@Controller()
export class PassController {
  constructor(
    private readonly pass: PassService,
    private readonly identity: ParticipantIdentityService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Issue this participant's pass for this event.
   *
   * POST because it mints a credential and retires the previous one — it is not
   * a read, and a GET that rotates a secret on every prefetch would be a trap.
   *
   * Works for a claimed account AND a guest session: at a real event the guest
   * path is the mainstream identity, and a pass only the minority can hold is
   * not a fast lane. `ParticipantIdentityService` owns that distinction.
   *
   * The raw token comes back exactly once. The caller keeps it — see 0176 — so
   * the pass still renders in a venue with no signal, which is where it is
   * presented. Opening the pass on a second device issues a fresh token and
   * retires the first; name search at the desk is the fallback for when that
   * bites.
   */
  @Post('events/:eventId/pass')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue the calling participant an event pass' })
  @ApiParam({ name: 'eventId', type: 'string', description: 'Event UUID or slug' })
  async issue(@Param('eventId') eventRef: string, @Req() req: FastifyRequest) {
    const eventId = await resolveEventId(this.supabase, eventRef);
    const personId = await this.identity.requirePersonId(req, eventId);
    return this.pass.issue(eventId, personId, 'self');
  }

  /**
   * Whose pass is this? — the page an emailed link opens.
   *
   * `@Public()` because the recipient has no session and, being an unclaimed
   * roster entry, may have no way to get one. Possession of the token IS the
   * credential, exactly as it is for the claim and email-change links this
   * mirrors.
   *
   * The projection is the security boundary and is deliberately tiny: the
   * fighter's name and the event, both of which are already in the inbox that
   * received the link. No club, no schedule, no ids, nothing about anyone else.
   * A wrong token is indistinguishable from an expired one, so this cannot be
   * used to enumerate which tokens exist.
   */
  @Public()
  @Get('event-passes/:token')
  @ApiOperation({
    summary: 'Preview an emailed event pass',
    description:
      'Name + event only. Possession of the token is the credential; the narrow projection is the boundary.',
  })
  @ApiParam({ name: 'token', type: 'string' })
  preview(@Param('token') token: string) {
    return this.pass.preview(token);
  }
}
