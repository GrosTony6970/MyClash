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

import { Controller, Get, Param, ParseUUIDPipe, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PublicScheduleService } from '../persons/public-schedule.service';

@ApiTags('schedule')
@Controller()
export class MyScheduleController {
  constructor(
    private readonly schedule: PublicScheduleService,
    private readonly guestJwt: GuestJwtService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/my-schedule')
  @ApiOperation({ summary: "Get authenticated person's unified schedule" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getMySchedule(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const personId = await this.resolvePersonId(req);
    // Person can always see their own workshops (requesterPersonId = personId)
    return this.schedule.getSchedule(eventId, personId, personId);
  }

  private async resolvePersonId(req: FastifyRequest): Promise<string> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;

    // Try claimed user
    const accessToken = cookies?.['sb-access-token'];
    if (accessToken) {
      const { data } = await this.supabase.anon.auth.getUser(accessToken);
      if (data.user) {
        const { data: person } = await this.supabase.service
          .from('persons')
          .select('id')
          .eq('claimed_by_user_id', data.user.id)
          .maybeSingle();
        if (person) return (person as { id: string }).id;
      }
    }

    // Try guest session
    const guestToken = cookies?.['mc_guest'];
    if (guestToken) {
      try {
        const payload = this.guestJwt.verify(guestToken);
        return payload.person_id;
      } catch {
        // Invalid token
      }
    }

    throw new UnauthorizedException('Authentication required to view your schedule');
  }
}
