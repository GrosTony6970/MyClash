import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffingConfigPayloadDto } from './dto/staffing.dto';
import { StaffingService } from './staffing.service';

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

@ApiTags('staffing')
@ApiBearerAuth()
@Controller()
export class StaffingController {
  constructor(
    private readonly staffing: StaffingService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/events/:eventId/slot-config — event default (resolved). */
  @Get('events/:eventId/slot-config')
  @ApiOperation({ summary: 'Get event-default staffing slot config (resolved)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getEventDefault(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staffing.getEventDefault(eventId, userId);
  }

  /** PUT /api/v1/events/:eventId/slot-config — org-admin gated. */
  @Put('events/:eventId/slot-config')
  @ApiOperation({ summary: 'Set event-default staffing slot config (org-admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async putEventDefault(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: StaffingConfigPayloadDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staffing.putEventDefault(eventId, dto, userId);
  }

  /** GET /api/v1/tournaments/:tournamentId/slot-config — resolved with event fallback. */
  @Get('tournaments/:tournamentId/slot-config')
  @ApiOperation({ summary: 'Get tournament staffing slot config (resolved)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getTournament(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staffing.getResolvedConfig(tournamentId, userId);
  }

  /** PUT /api/v1/tournaments/:tournamentId/slot-config — org-admin gated. */
  @Put('tournaments/:tournamentId/slot-config')
  @ApiOperation({ summary: 'Set tournament staffing slot config (org-admin+)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async putTournament(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: StaffingConfigPayloadDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staffing.putTournamentConfig(tournamentId, dto, userId);
  }

  /** POST /api/v1/tournaments/:tournamentId/slot-config/reset — drop tournament rows. */
  @Post('tournaments/:tournamentId/slot-config/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset tournament slot config (drop rows, fall back to event default)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async reset(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.staffing.resetTournamentConfig(tournamentId, userId);
  }
}
