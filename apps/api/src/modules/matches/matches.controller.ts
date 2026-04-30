import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { ClockService, type ClockAction } from './clock.service';
import { MatchesService } from './matches.service';
import {
  CreateExchangeDto,
  CreateMatchDto,
  UpdateMatchStatusDto,
  VoidExchangeDto,
} from './dto/matches.dto';

class ClockActionDto {
  @IsIn(['start', 'halt', 'resume', 'end', 'reset_clock'])
  action!: ClockAction;

  @IsOptional() @IsString()
  reason?: string;
}

@ApiTags('matches')
@ApiBearerAuth()
@Controller()
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly clock: ClockService,
  ) {}

  // ── Matches ──────────────────────────────────────────────────────────────────

  @Get('phases/:phaseId/matches')
  @ApiOperation({ summary: 'List matches for a phase (public)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  async listByPhase(@Param('phaseId', ParseUUIDPipe) phaseId: string) {
    return this.matches.listByPhase(phaseId);
  }

  @Get('matches/:id')
  @ApiOperation({ summary: 'Get match by ID (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.getMatch(id);
  }

  @Post('phases/:phaseId/matches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a match (org admin+)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  async createMatch(@Body() dto: CreateMatchDto) {
    return this.matches.createMatch(dto);
  }

  @Patch('matches/:id/status')
  @ApiOperation({ summary: 'Update match status (scorekeeper+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchStatusDto,
  ) {
    return this.matches.updateStatus(id, dto);
  }

  @Post('matches/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a match (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidMatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.voidMatch(id);
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────────

  @Get('matches/:id/exchanges')
  @ApiOperation({ summary: 'List exchanges for a match (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listExchanges(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.listExchanges(id);
  }

  /**
   * POST /api/v1/matches/:id/exchanges
   * Idempotent on client_uuid — safe to call multiple times from offline queue.
   */
  @Post('matches/:id/exchanges')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an exchange (scorekeeper+, idempotent on client_uuid)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExchangeDto,
  ) {
    return this.matches.createExchange(id, dto);
  }

  /**
   * PATCH /api/v1/exchanges/:id/void
   * Sets voided=true. Never deletes the row.
   */
  @Patch('exchanges/:id/void')
  @ApiOperation({ summary: 'Void an exchange (organizer+). Never deletes.' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidExchangeDto,
  ) {
    return this.matches.voidExchange(id, dto);
  }

  // ── Clock endpoints ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/matches/:id/clock
   * Returns current clock state computed from match_events timeline.
   * Reload-safe: always recomputes from server state.
   */
  @Get('matches/:id/clock')
  @ApiOperation({ summary: 'Get clock state (computed from match_events timeline)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getClockState(@Param('id', ParseUUIDPipe) id: string) {
    return this.clock.getClockState(id);
  }

  /**
   * POST /api/v1/matches/:id/clock
   * Perform a clock action: start | halt | resume | end | reset_clock.
   * Persists a match_events row and updates match.status.
   */
  @Post('matches/:id/clock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clock action: start | halt | resume | end | reset_clock' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async clockAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClockActionDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    return this.clock.clockAction(id, dto.action, dto.reason, userId);
  }
}
