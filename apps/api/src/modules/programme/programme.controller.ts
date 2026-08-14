import { Public } from '../../common/auth/public.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ProgrammeService } from './programme.service';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveRequestUserId } from '../../common/auth/request-user';
import {
  CreateBlockDto,
  MoveBlockDto,
  ResizeBlockDto,
  SaveProgrammeDto,
  ScheduleGroupDto,
  SuggestProgrammeDto,
  UpdateBlockLabelDto,
} from './dto/programme.dto';

/**
 * `@Public()` is METHOD-level on `listBlocks`, never on the class. The public
 * event site reads the programme logged out, so a class-level guard here would
 * take that read down along with the ten writes.
 *
 * Those ten had no authorization of any kind — including
 * `DELETE /programme/full`, which unschedules every match in the event. The
 * service asserts the caller's org role now; since every query runs as the
 * BYPASSRLS service role, that assertion is the whole boundary.
 */
@ApiTags('programme')
@Controller()
export class ProgrammeController {
  constructor(
    private readonly programme: ProgrammeService,
    private readonly supabase: SupabaseService,
  ) {}

  private caller(req: FastifyRequest): Promise<string> {
    return resolveRequestUserId(req, this.supabase);
  }

  /** GET /api/v1/events/:eventId/programme */
  @Public()
  @Get('events/:eventId/programme')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all programme blocks for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  listBlocks(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.programme.listBlocks(eventId, () => this.caller(req));
  }

  /** PUT /api/v1/events/:eventId/programme */
  @Put('events/:eventId/programme')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace all programme blocks for an event (bulk save)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async saveBlocks(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SaveProgrammeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.saveBlocks(eventId, dto, await this.caller(req));
  }

  /** POST /api/v1/events/:eventId/programme/suggest */
  @Post('events/:eventId/programme/suggest')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate a suggested programme (does not persist)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async suggest(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SuggestProgrammeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.suggest(eventId, dto, await this.caller(req));
  }

  /** POST /api/v1/events/:eventId/programme/generate */
  @Post('events/:eventId/programme/generate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Generate match schedule and workshop sessions from saved blocks. Optional dayIndices scopes generation to those days only.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async generate(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
    @Body() dto?: { dayIndices?: number[] },
  ) {
    return this.programme.generate(eventId, dto ?? {}, await this.caller(req));
  }

  /** POST /api/v1/events/:eventId/programme/blocks */
  @Post('events/:eventId/programme/blocks')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create a single programme block (admin / break bar). Appends one row at the next sort_order on its day — used by the grid add-break + undo-after-delete paths.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async createBlock(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateBlockDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.createBlock(eventId, dto, await this.caller(req));
  }

  /** PATCH /api/v1/events/:eventId/programme/blocks/:blockId/move */
  @Patch('events/:eventId/programme/blocks/:blockId/move')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Move a fixed programme block to a new start time; cascade-shifts every match scheduled at or after the old start on the same day by the same Δ',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'blockId', type: 'string', format: 'uuid' })
  async moveBlock(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: MoveBlockDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.moveBlock(eventId, blockId, dto, await this.caller(req));
  }

  /** PATCH /api/v1/events/:eventId/programme/blocks/:blockId/resize */
  @Patch('events/:eventId/programme/blocks/:blockId/resize')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Resize a programme block by changing its end_time. The block's start_time stays put — only the duration changes. Validates newEndTime > startTime.",
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'blockId', type: 'string', format: 'uuid' })
  async resizeBlock(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: ResizeBlockDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.resizeBlock(eventId, blockId, dto, await this.caller(req));
  }

  /** POST /api/v1/events/:eventId/programme/schedule-group */
  @Post('events/:eventId/programme/schedule-group')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Re-fan a group of matches (a pool or a bracket sub-tree) across the given lices from a start time, branch-aware for brackets, appending after existing occupants.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async scheduleGroup(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ScheduleGroupDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.scheduleGroup(eventId, dto, await this.caller(req));
  }

  /** PATCH /api/v1/events/:eventId/programme/blocks/:blockId */
  @Patch('events/:eventId/programme/blocks/:blockId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rename a single programme block (admin / break / workshop bar)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'blockId', type: 'string', format: 'uuid' })
  async updateBlockLabel(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: UpdateBlockLabelDto,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.updateBlockLabel(eventId, blockId, dto, await this.caller(req));
  }

  /** DELETE /api/v1/events/:eventId/programme/blocks/:blockId */
  @Delete('events/:eventId/programme/blocks/:blockId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Delete a single programme block. Matches scheduled INSIDE the block window on the same day are unscheduled (scheduled_at + lice_id → null) so they reappear in the Unscheduled sidebar.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'blockId', type: 'string', format: 'uuid' })
  async deleteBlock(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.programme.deleteBlock(eventId, blockId, await this.caller(req));
  }

  /** DELETE /api/v1/events/:eventId/programme/full */
  @Delete('events/:eventId/programme/full')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reset the schedule: delete every programme block AND null scheduled_at + lice_id on every match in the event',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async resetAll(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.programme.resetAll(eventId, await this.caller(req));
  }
}
