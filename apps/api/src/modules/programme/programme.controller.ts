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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ProgrammeService } from './programme.service';
import { SaveProgrammeDto, SuggestProgrammeDto } from './dto/programme.dto';

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
}
