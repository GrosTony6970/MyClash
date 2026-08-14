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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { LicesService } from './lices.service';
import { SupabaseService } from '../supabase/supabase.service';
import { Public } from '../../common/auth/public.decorator';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { CreateLiceDto, UpdateLiceDto } from './dto/lices.dto';

/**
 * `@Public()` is METHOD-level on the read, never on the class. The public
 * event site reads this list logged out, and a class-level guard here would
 * take that read down with the writes.
 *
 * The writes carried "(org admin+)" in their summaries and enforced nothing —
 * the service now asserts the caller's org role, which is the whole boundary
 * given every query runs as the BYPASSRLS service role.
 *
 * The read is gated too, on the EVENT rather than on the caller: public until
 * the event is published, org-only before that.
 */
@ApiTags('lices')
@Controller()
export class LicesController {
  constructor(
    private readonly lices: LicesService,
    private readonly supabase: SupabaseService,
  ) {}

  @Public()
  @Get('events/:eventId/lices')
  @ApiOperation({ summary: 'List lices for an event (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.lices.list(eventId, () => resolveRequestUserId(req, this.supabase));
  }

  @Post('events/:eventId/lices')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a lice (org editor+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLiceDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    return this.lices.create(eventId, dto, userId);
  }

  @Patch('lices/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a lice (org editor+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLiceDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    return this.lices.update(id, dto, userId);
  }

  @Delete('lices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a lice (org editor+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.lices.delete(id, userId);
  }
}
