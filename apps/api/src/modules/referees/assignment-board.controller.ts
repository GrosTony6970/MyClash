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
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
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

@ApiTags('referees')
@Controller()
export class AssignmentBoardController {
  constructor(private readonly assignments: AssignmentBoardService) {}

  @Get('events/:eventId/referee-assignment-board')
  @ApiOperation({
    summary:
      'Read the referee assignment board (persisted assignments only — no auto-assign engine run)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getBoard(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.getBoard(eventId);
  }

  @Post('events/:eventId/referee-assignment-board/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run the auto-assign engine and return the board with proposals overlaid (isProposal: true on engine chips)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async previewBoard(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.previewBoard(eventId);
  }

  @Get('tournaments/:tournamentId/pool-match-role-config')
  @ApiOperation({
    summary:
      'Distinct referee roles to render as columns in the pool-match table. Returns system + per-event custom skills.',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getPoolMatchRoleConfig(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.assignments.getPoolMatchRoleConfig(tournamentId);
  }

  @Post('events/:eventId/referee-assignment-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview referee auto-assignment without persisting' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async preview(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.preview(eventId);
  }

  @Post('events/:eventId/referee-assignment-preview/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply the current referee auto-assignment preview' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async applyPreview(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.applyPreview(eventId);
  }

  @Post('events/:eventId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign one referee to one pool role after validation' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async manualAssign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ManualAssignmentRequestDto,
  ) {
    return this.assignments.applyManual(eventId, dto);
  }

  @Post('referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Legacy manual referee assignment endpoint' })
  async legacyManualAssign(@Body() dto: LegacyManualAssignmentRequestDto) {
    return this.assignments.applyManual(dto.eventId, dto);
  }

  @Delete('referee-assignments/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove one referee assignment (refuses when locked)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteAssignment(@Param('id', ParseUUIDPipe) assignmentId: string) {
    return this.assignments.deleteAssignment(assignmentId);
  }

  @Delete('events/:eventId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear every referee assignment for an event (refuses when locked)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async clearEventAssignments(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.clearEventAssignments(eventId);
  }

  @Delete('pools/:poolId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear every referee assignment for one pool — pool-scope rows + per-match rows for the pool (refuses when locked)',
  })
  @ApiParam({ name: 'poolId', type: 'string', format: 'uuid' })
  async clearPoolAssignments(@Param('poolId', ParseUUIDPipe) poolId: string) {
    return this.assignments.clearPoolAssignments(poolId);
  }

  @Delete('swiss-rounds/:roundId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear every referee assignment for one Swiss round, across all its pistes (refuses when locked)',
  })
  @ApiParam({ name: 'roundId', type: 'string', format: 'uuid' })
  async clearSwissRoundAssignments(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.assignments.clearSwissRoundAssignments(roundId);
  }
}
