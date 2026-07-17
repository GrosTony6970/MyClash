/**
 * public-schedule.controller.ts — T-608
 *
 * GET /api/v1/events/:eventId/people/:personId/schedule
 *
 * Returns person's schedule with privacy filters.
 * Email never returned. Workshops hidden if person opted out (unless own person).
 */

import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { Public } from '../../common/auth/public.decorator';
import { PublicScheduleService } from './public-schedule.service';

// Public event schedule — rendered for logged-out visitors on the public site.
@Public()
@ApiTags('persons')
@Controller()
export class PublicScheduleController {
  constructor(
    private readonly schedule: PublicScheduleService,
    private readonly guestJwt: GuestJwtService,
  ) {}

  @Get('events/:eventId/people/:personId/schedule')
  @ApiOperation({ summary: "Get person's schedule (public, privacy-filtered)" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule returned' })
  async getSchedule(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    // Resolve requester's person_id from guest cookie (if present)
    const requesterPersonId = this.resolveRequesterPersonId(req);
    return this.schedule.getSchedule(eventId, personId, requesterPersonId);
  }

  private resolveRequesterPersonId(req: FastifyRequest): string | null {
    try {
      const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
      const token = cookies?.['mc_guest'];
      if (!token) return null;
      const payload = this.guestJwt.verify(token);
      return payload.person_id ?? null;
    } catch {
      return null;
    }
  }
}
