/**
 * GET /api/v1/events/:eventId/people/:personId — the public person page's header (ruling 121a).
 *
 * Public does not mean unconditional: `PublicPersonService.getProfile` holds the person schedule's
 * bar (Event readable, person in it) before it reads anything.
 */
import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveFollowIdentity } from './follow-identity';
import { PublicPersonService } from './public-person.service';

@Public()
@ApiTags('persons')
@Controller()
export class PublicPersonController {
  constructor(
    private readonly people: PublicPersonService,
    private readonly guestJwt: GuestJwtService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/people/:personId')
  @ApiOperation({ summary: "Get a person's public profile in one Event" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Profile returned' })
  @ApiResponse({ status: 404, description: 'Event hidden from the caller, or person not in it' })
  async getProfile(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.people.getProfile(eventId, personId, publicReader(req), () =>
      resolveFollowIdentity(req, this.supabase, this.guestJwt),
    );
  }
}
