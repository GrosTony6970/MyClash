/**
 * event-stats.controller.ts
 *
 * Organizer event-statistics endpoints (org-role guarded in the service):
 *   GET /api/v1/events/:eventId/statistics
 *   GET /api/v1/events/:eventId/statistics/tournaments/:tournamentId
 */

import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { EventStatsService } from './event-stats.service';

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
  ) {}

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
