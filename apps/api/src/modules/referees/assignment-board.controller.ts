import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import {
  assertCanManageEvent,
  assertCanManagePool,
  assertCanManageRefereeAssignment,
  assertCanManageSwissRound,
  assertEventMember,
  assertTournamentMember,
} from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AssignmentBoardService, REFEREE_ASSIGNMENT_ROLES } from './assignment-board.service';

const manualAssignmentRequestSchema = z
  .object({
    poolId: z.uuid(),
    role: z.enum(REFEREE_ASSIGNMENT_ROLES as [string, ...string[]]),
    personId: z.uuid(),
  })
  .strict();
class ManualAssignmentRequestDto extends createZodDto(manualAssignmentRequestSchema) {}

const legacyManualAssignmentRequestSchema = manualAssignmentRequestSchema
  .extend({
    eventId: z.uuid(),
  })
  .strict();
class LegacyManualAssignmentRequestDto extends createZodDto(legacyManualAssignmentRequestSchema) {}

/**
 * The referee assignment board.
 *
 * AUTHORIZATION IS PER ROUTE, and every route has it. Until 2026-08-15 not one
 * of these eleven did: under the global `AuthGuard` they required *a* logged-in
 * account, but nothing tied that account to the event, so any authenticated user
 * could read any event's roster — or wipe it.
 *
 * Two bars. A read needs membership at any role (`assertEventMember`), because
 * the crew rostered to run an event has to be able to see it. A write needs the
 * event-management bar, the same one the schedule writes use.
 *
 * Deliberately not a guard. These eleven routes address the event through SIX
 * different keys — event, tournament, pool, Swiss round, assignment id, and one
 * legacy route carrying the id in its BODY. `EventReadOnlyGuard` resolves by
 * path and has FAILED OPEN twice when a params name did not match; an explicit
 * assertion per route is longer, and a missed one is visible rather than silent.
 */
@ApiTags('referees')
@Controller()
export class AssignmentBoardController {
  constructor(
    private readonly assignments: AssignmentBoardService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Deps in the shape `event-authz` takes. */
  private get authz() {
    return { supabase: this.supabase, orgs: this.organizations };
  }

  /** The sentinel, not a throw: the org-role assertion turns an anonymous
   *  caller into a 403 that says what was wrong. */
  private userId(req: FastifyRequest): Promise<string> {
    return resolveRequestUserId(req, this.supabase);
  }

  @Get('events/:eventId/referee-assignment-board')
  @ApiOperation({
    summary:
      'Read the referee assignment board (persisted assignments only — no auto-assign engine run)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getBoard(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    await assertEventMember(this.authz, eventId, await this.userId(req));
    return this.assignments.getBoard(eventId);
  }

  @Post('events/:eventId/referee-assignment-board/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run the auto-assign engine and return the board with proposals overlaid (isProposal: true on engine chips)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async previewBoard(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    // Persists nothing, but it runs the engine over the whole roster and hands
    // back names — a read, at the read bar.
    await assertEventMember(this.authz, eventId, await this.userId(req));
    return this.assignments.previewBoard(eventId);
  }

  @Get('tournaments/:tournamentId/pool-match-role-config')
  @ApiOperation({
    summary:
      'Distinct referee roles to render as columns in the pool-match table. Returns system + per-event custom skills.',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getPoolMatchRoleConfig(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertTournamentMember(this.authz, tournamentId, await this.userId(req));
    return this.assignments.getPoolMatchRoleConfig(tournamentId);
  }

  @Post('events/:eventId/referee-assignment-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview referee auto-assignment without persisting' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async preview(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    await assertEventMember(this.authz, eventId, await this.userId(req));
    return this.assignments.preview(eventId);
  }

  @Post('events/:eventId/referee-assignment-preview/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply the current referee auto-assignment preview' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async applyPreview(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    await assertCanManageEvent(this.authz, eventId, await this.userId(req));
    return this.assignments.applyPreview(eventId);
  }

  @Post('events/:eventId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign one referee to one pool role after validation' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async manualAssign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ManualAssignmentRequestDto,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManageEvent(this.authz, eventId, await this.userId(req));
    return this.assignments.applyManual(eventId, dto);
  }

  @Post('referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Legacy manual referee assignment endpoint' })
  async legacyManualAssign(
    @Body() dto: LegacyManualAssignmentRequestDto,
    @Req() req: FastifyRequest,
  ) {
    // The one route that names its event in the BODY rather than the path. It is
    // authorized against that id, so a caller cannot borrow one event's
    // permission to write to another.
    await assertCanManageEvent(this.authz, dto.eventId, await this.userId(req));
    return this.assignments.applyManual(dto.eventId, dto);
  }

  @Delete('referee-assignments/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove one referee assignment (refuses when locked)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteAssignment(
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManageRefereeAssignment(this.authz, assignmentId, await this.userId(req));
    return this.assignments.deleteAssignment(assignmentId);
  }

  @Delete('events/:eventId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear every referee assignment for an event (refuses when locked)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async clearEventAssignments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManageEvent(this.authz, eventId, await this.userId(req));
    return this.assignments.clearEventAssignments(eventId);
  }

  @Delete('pools/:poolId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear every referee assignment for one pool — pool-scope rows + per-match rows for the pool (refuses when locked)',
  })
  @ApiParam({ name: 'poolId', type: 'string', format: 'uuid' })
  async clearPoolAssignments(
    @Param('poolId', ParseUUIDPipe) poolId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManagePool(this.authz, poolId, await this.userId(req));
    return this.assignments.clearPoolAssignments(poolId);
  }

  @Delete('swiss-rounds/:roundId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear every referee assignment for one Swiss round, across all its pistes (refuses when locked)',
  })
  @ApiParam({ name: 'roundId', type: 'string', format: 'uuid' })
  async clearSwissRoundAssignments(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManageSwissRound(this.authz, roundId, await this.userId(req));
    return this.assignments.clearSwissRoundAssignments(roundId);
  }
}
