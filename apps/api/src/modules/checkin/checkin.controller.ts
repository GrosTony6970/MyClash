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
import { MarkArrivalDto, RosterQueryDto, ScanPassDto } from './dto';

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

  /**
   * Redeem a scanned pass: resolve it and mark that person present, in one call.
   *
   * One call rather than resolve-then-confirm because the scanner stays live and
   * the queue keeps moving — ten people is ten scans with no tap between, which
   * is the entire reason the fast lane exists. The confirmation stacks up on
   * screen afterwards with Undo still reachable, so a wrong scan is corrected
   * without stopping the line.
   *
   * Safe to auto-mark here in a way it would NOT be from the search path: a
   * search hit can be the wrong Marie, a token cannot. That difference is
   * exactly what `event_arrivals.via` records.
   */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redeem a scanned event pass and mark that person present',
    description:
      "Resolves the token within this staff session's event and marks arrival with via=qr. 404 pass_not_recognized / pass_expired are readable states, not failures of the desk.",
  })
  async scan(@Body() dto: ScanPassDto, @Req() req: FastifyRequest) {
    return this.checkin.redeemPass(req, dto.token);
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
