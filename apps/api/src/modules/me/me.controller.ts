/**
 * me.controller.ts
 *
 * Personal-space cross-event endpoints for the redesigned /me:
 *   GET /api/v1/me/events           — events the current user is involved in
 *   GET /api/v1/me/upcoming         — next N fights + referee slots across all events
 *   GET /api/v1/me/leagues          — published leagues the user is ranked in
 *   GET /api/v1/me/workshop-history — attended workshops grouped by event
 *
 * Auth: resolves the claimed user from the Supabase access token (Bearer header
 * or `sb-access-token` cookie), mirroring the other authenticated /me routes.
 */

import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { MeEventsService } from './me-events.service';

async function resolveUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user) throw new UnauthorizedException('Invalid session');
  return user.id;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeEventsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events')
  @ApiOperation({
    summary: 'List the events the current user is involved in (competitor / referee / workshops)',
  })
  async events(@Req() req: FastifyRequest) {
    const userId = await resolveUserId(req, this.supabase);
    return this.me.listMyEvents(userId);
  }

  @Get('upcoming')
  @ApiOperation({ summary: "Next N fights + referee slots across all the user's events" })
  async upcoming(@Req() req: FastifyRequest, @Query('limit') limit?: string) {
    const userId = await resolveUserId(req, this.supabase);
    const parsed = Number.parseInt(limit ?? '5', 10);
    const n = Math.min(20, Math.max(1, Number.isFinite(parsed) ? parsed : 5));
    return this.me.getUpcoming(userId, n);
  }

  @Get('leagues')
  @ApiOperation({
    summary: 'Published leagues the current user is ranked in (with their standings)',
  })
  async leagues(@Req() req: FastifyRequest) {
    const userId = await resolveUserId(req, this.supabase);
    return this.me.listMyLeagues(userId);
  }

  @Get('workshop-history')
  @ApiOperation({
    summary: 'Workshops the current user has attended (confirmed/intent), grouped by event',
  })
  async workshopHistory(@Req() req: FastifyRequest) {
    const userId = await resolveUserId(req, this.supabase);
    return { events: await this.me.getMyWorkshopHistory(userId) };
  }
}
