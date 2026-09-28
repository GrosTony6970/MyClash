/**
 * public-schedule.controller.ts — T-608
 *
 * GET /api/v1/events/:eventId/people/:personId/schedule
 *
 * Returns person's schedule with privacy filters.
 * Email never returned. Workshops hidden if person opted out (unless own person).
 *
 * Public does NOT mean unconditional. A draft Event is hidden from anyone but its
 * club and its active staff, a person is served only under their own Event's id,
 * and not when entered only in a draft Tournament — `readEventPerson`, the person
 * page's gate, checks all of it before the schedule is read.
 */

import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { Public } from '../../common/auth/public.decorator';
import { publicReader } from '../../common/auth/competition-visibility';
import { PublicScheduleService } from './public-schedule.service';

// Public event schedule — rendered for logged-out visitors on the public site.
@Public()
@ApiTags('persons')
@Controller()
export class PublicScheduleController {
  constructor(
    private readonly schedule: PublicScheduleService,
    private readonly identity: ParticipantIdentityService,
  ) {}

  @Get('events/:eventId/people/:personId/schedule')
  @ApiOperation({ summary: "Get person's schedule (public, privacy-filtered)" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule returned' })
  @ApiResponse({ status: 404, description: 'Event hidden from the caller, or person not in it' })
  async getSchedule(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.schedule.getPublicSchedule(
      eventId,
      personId,
      // Is the viewer this person? Only then do workshops they hid still show. The
      // one owner of that answer checks the cookie's signature, its Event and that
      // the guest session was not signed out.
      () => this.identity.resolvePersonId(req, eventId),
      publicReader(req),
    );
  }
}
