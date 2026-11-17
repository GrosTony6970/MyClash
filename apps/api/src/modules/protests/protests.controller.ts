import {
  Body,
  Controller,
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
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { canReadMatch, publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { OrganizationsService } from '../organizations/organizations.service';
import { StaffService } from '../staff/staff.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProtestDto, VoidProtestDto } from './dto/protests.dto';
import { ProtestsService } from './protests.service';

/** A Match's protests, in the card doors' style (`PenaltiesController`). */
@ApiTags('protests')
@ApiBearerAuth()
@Controller()
export class ProtestsController {
  constructor(
    private readonly protests: ProtestsService,
    private readonly supabase: SupabaseService,
    private readonly staff: StaffService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Public()
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
  @Get('matches/:id/protests')
  @ApiOperation({ summary: 'List the protests of a match, voided ones included' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listMatchProtests(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    // A hidden bout answers as an unknown one: no protests, as no cards (rulings 81-83, 89).
    const deps = { supabase: this.supabase, orgs: this.orgs };
    if (!(await canReadMatch(deps, id, publicReader(req)))) return [];
    return this.protests.listMatchProtests(id);
  }

  @Post('matches/:id/protests')
  @AllowOnArchivedEvent() // as a card (ruling 240): a saved protest is answered
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a protest of a fighter against the referee call' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createProtest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProtestDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id, 'leave-to-handler');
    return this.protests.createProtest(id, dto, actor);
  }

  @Patch('match-protests/:id/void')
  @AllowOnArchivedEvent() // as a card's void (ruling 222a)
  @ApiOperation({ summary: 'Void a protest without deleting it' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidProtest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidProtestDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeEntryScoring(req, 'match_protests', id);
    return this.protests.voidProtest(id, dto, actor);
  }
}
