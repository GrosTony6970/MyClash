/**
 * event-stats.controller.ts
 *
 * Organizer event-statistics endpoints (org-role guarded in the service):
 *   GET /api/v1/events/:eventId/statistics
 *   GET /api/v1/events/:eventId/statistics/tournaments/:tournamentId
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { EventStatsService } from './event-stats.service';
// Value imports (NOT `import type`) — DI-injected, so the runtime needs the
// class metadata preserved.
import { EventFeedbackService } from './event-feedback.service';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { SubmitEventFeedbackDto } from './dto/event-feedback.dto';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const user = await supabase.getAuthUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('event-stats')
@Controller()
export class EventStatsController {
  constructor(
    private readonly eventStats: EventStatsService,
    private readonly supabase: SupabaseService,
    private readonly feedback: EventFeedbackService,
    private readonly participants: ParticipantIdentityService,
  ) {}

  /**
   * POST /api/v1/events/:eventId/feedback
   *
   * Open to anyone on the roster — fighter, referee, instructor or workshop
   * attendee — and to guests, because `requirePersonId` resolves a claimed user
   * OR a guest session to the same event-scoped persons.id. The respondent's
   * ROLE is derived from the roster in the service, never taken from the body.
   */
  @Post('events/:eventId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Submit feedback on an event you attended' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async submitFeedback(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SubmitEventFeedbackDto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const personId = await this.participants.requirePersonId(req, eventId);
    await this.feedback.submit(eventId, personId, dto);
  }

  /** GET /api/v1/events/:eventId/feedback — organizer view, anonymised. */
  @Get('events/:eventId/feedback')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregated event feedback (anonymous unless the author opted in)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getFeedback(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.feedback.summary(eventId, userId);
  }

  /** GET /api/v1/events/:eventId/statistics */
  @Get('events/:eventId/statistics')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Organizer event statistics (rollup + per-tournament summaries)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getEventStatistics(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.eventStats.getEventStatistics(eventId, userId);
  }

  /** GET /api/v1/events/:eventId/statistics/tournaments/:tournamentId */
  @Get('events/:eventId/post-event-report')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'What happened during the event: refused exchanges, overrides, desk' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getPostEventReport(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.eventStats.getPostEventReport(eventId, userId);
  }

  @Get('events/:eventId/statistics/tournaments/:tournamentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Per-tournament stats detail (overall standings + per-fighter table)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getTournamentDetail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.eventStats.getTournamentDetail(eventId, tournamentId, userId);
  }
}
