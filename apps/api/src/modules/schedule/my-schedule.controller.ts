/**
 * my-schedule.controller.ts — T-805
 *
 * GET /api/v1/events/:eventId/my-schedule
 *
 * Returns the authenticated person's unified schedule:
 *   matches + referee_slots + workshops (privacy-filtered)
 *
 * Reuses PublicScheduleService from T-608.
 * Dep on T-901 (referee qualifications) — referee_slots will be empty
 * until referee_assignments table is populated.
 */

import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { resolveEventId } from '../../common/event-ref';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PublicScheduleService } from '../persons/public-schedule.service';

@ApiTags('schedule')
@Controller()
export class MyScheduleController {
  constructor(
    private readonly schedule: PublicScheduleService,
    private readonly supabase: SupabaseService,
    // "Which persons row is the caller at this event" used to be a private
    // method here. It moved to ParticipantIdentityService when the event pass
    // needed the same answer — two copies would have been two definitions of
    // who a participant is. The move also fixed a guest-session cookie for
    // another event resolving to that other event's person.
    private readonly identity: ParticipantIdentityService,
  ) {}

  /**
   * Takes a slug OR an id.
   *
   * It used to be `ParseUUIDPipe`, while its only caller — the page at
   * `/e/[eventSlug]/my-schedule` — sent the slug straight out of the URL. Every
   * request 400'd, the page's `res.ok` branch swallowed it, and the surface
   * rendered its logged-out empty state to signed-in fighters. Nothing caught it
   * because the one spec that covers this page mocks the route away.
   */
  @Get('events/:eventId/my-schedule')
  @ApiOperation({ summary: "Get authenticated person's unified schedule" })
  @ApiParam({ name: 'eventId', type: 'string', description: 'Event UUID or slug' })
  async getMySchedule(@Param('eventId') eventRef: string, @Req() req: FastifyRequest) {
    const eventId = await resolveEventId(this.supabase, eventRef);
    const personId = await this.identity.requirePersonId(req, eventId);
    // Person can always see their own workshops (requesterPersonId = personId)
    return this.schedule.getSchedule(eventId, personId, personId);
  }
}
