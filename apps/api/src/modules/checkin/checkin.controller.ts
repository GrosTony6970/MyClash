import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CheckinService } from './checkin.service';
import { MarkArrivalDto, RosterQueryDto } from './dto';

/**
 * The check-in desk, for a staff account holding the `checkin` role.
 *
 * Every route is EVENT-scoped: the mc_staff session names the event, and the
 * service filters by it. A desk account has no Lice assignment, so there is no
 * piste-scoped gate to apply and none is wanted — a volunteer at the door
 * checks in anyone at that event.
 *
 * None of this gates anything. Arrival is informational: no scoring or
 * scheduling path reads `event_arrivals`, and none may. The referee at the
 * piste is the enforcement.
 */
@ApiTags('checkin')
@Controller('staff/checkin')
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get('roster')
  @ApiOperation({
    summary: 'Search this event roster, each row carrying its arrival state',
    description:
      'Three letters is enough. Carries photo and club so the volunteer can confirm the person in front of them — two fighters with similar names is the failure this prevents.',
  })
  async roster(@Query() query: RosterQueryDto, @Req() req: FastifyRequest) {
    return this.checkin.searchRoster(req, query.q);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Arrived / total for this event' })
  async summary(@Req() req: FastifyRequest) {
    return this.checkin.getSummary(req);
  }

  @Get('missing')
  @ApiOperation({
    summary: 'Fighters who have not arrived, ordered by how soon they fight',
    description:
      'Unscheduled fighters sort last rather than being hidden: they are still missing, just not yet costing anyone time.',
  })
  async missing(@Req() req: FastifyRequest) {
    return this.checkin.getMissingAtRisk(req);
  }

  @Post(':personId/arrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a person as arrived' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async arrive(
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: MarkArrivalDto,
    @Req() req: FastifyRequest,
  ) {
    return this.checkin.markArrived(req, personId, dto);
  }

  @Post(':personId/undo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Undo an arrival',
    description:
      'A state change with its own actor, not a delete — so a mis-tap stays auditable rather than vanishing.',
  })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async undo(@Param('personId', ParseUUIDPipe) personId: string, @Req() req: FastifyRequest) {
    return this.checkin.undoArrival(req, personId);
  }
}
