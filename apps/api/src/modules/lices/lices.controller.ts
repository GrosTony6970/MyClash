import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LicesService } from './lices.service';
import { CreateLiceDto, UpdateLiceDto } from './dto/lices.dto';

@ApiTags('lices')
@Controller()
export class LicesController {
  constructor(private readonly lices: LicesService) {}

  @Get('events/:eventId/lices')
  @ApiOperation({ summary: 'List lices for an event (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.lices.list(eventId);
  }

  @Post('events/:eventId/lices')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a lice (org admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLiceDto,
  ) {
    return this.lices.create(eventId, dto);
  }

  @Patch('lices/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a lice (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLiceDto,
  ) {
    return this.lices.update(id, dto);
  }

  @Delete('lices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a lice (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.lices.delete(id);
  }
}
