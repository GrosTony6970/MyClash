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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ProgrammeService } from './programme.service';
import { MoveBlockDto, SaveProgrammeDto, SuggestProgrammeDto } from './dto/programme.dto';

@ApiTags('programme')
@Controller()
export class ProgrammeController {
  constructor(private readonly programme: ProgrammeService) {}

  /** GET /api/v1/events/:eventId/programme */
  @Get('events/:eventId/programme')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all programme blocks for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  listBlocks(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.programme.listBlocks(eventId);
  }

  /** PUT /api/v1/events/:eventId/programme */
  @Put('events/:eventId/programme')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace all programme blocks for an event (bulk save)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  saveBlocks(@Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: SaveProgrammeDto) {
    return this.programme.saveBlocks(eventId, dto);
  }

  /** POST /api/v1/events/:eventId/programme/suggest */
  @Post('events/:eventId/programme/suggest')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate a suggested programme (does not persist)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  suggest(@Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: SuggestProgrammeDto) {
    return this.programme.suggest(eventId, dto);
  }

  /** POST /api/v1/events/:eventId/programme/generate */
  @Post('events/:eventId/programme/generate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate match schedule and workshop sessions from saved blocks' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  generate(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.programme.generate(eventId);
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
  moveBlock(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: MoveBlockDto,
  ) {
    return this.programme.moveBlock(eventId, blockId, dto);
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
  resetAll(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.programme.resetAll(eventId);
  }
}
