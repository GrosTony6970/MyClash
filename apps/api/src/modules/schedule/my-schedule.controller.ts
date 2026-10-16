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

import { Controller, Get, Param, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { publicReader, readableEvent } from '../../common/auth/competition-visibility';
import { eventNotFound } from '../../common/auth/event-read-gate';
import { carriesEndedLogin } from '../../common/auth/identity';
import { resolveEventId } from '../../common/event-ref';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
// Value import, not `import type`: a type import erases the DI metadata.
import { OrganizationsService } from '../organizations/organizations.service';
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
    private readonly orgs: OrganizationsService,
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
  /**
   * A draft or test Event answers as an unknown one, as every other page of it does
   * (operator ruling 2026-10-16): its bouts' own pages say "not found" to its guests.
   * Its club and its active staff still read it. Before the person: a hidden Event
   * says nothing about who is in it.
   *
   * A login whose hour is up answers 401 first, whatever the Event: read as a stranger,
   * the club member of a draft Event got "not found", which nothing renews, and her phone
   * dropped its copy of her schedule. The answer turns on the login alone, so it says
   * nothing about the Event.
   */
  @Get('events/:eventId/my-schedule')
  @ApiOperation({ summary: "Get authenticated person's unified schedule" })
  @ApiParam({ name: 'eventId', type: 'string', description: 'Event UUID or slug' })
  async getMySchedule(@Param('eventId') eventRef: string, @Req() req: FastifyRequest) {
    if (carriesEndedLogin(req)) throw new UnauthorizedException('Authentication required');
    const eventId = await resolveEventId(this.supabase, eventRef);
    const deps = { supabase: this.supabase, orgs: this.orgs };
    if (!(await readableEvent(deps, eventId, publicReader(req)))) throw eventNotFound(eventId);
    const personId = await this.identity.requirePersonId(req, eventId);
    // Person can always see their own workshops (requesterPersonId = personId)
    return this.schedule.getSchedule(eventId, personId, personId);
  }
}
