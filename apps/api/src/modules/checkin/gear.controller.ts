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
import { GearService } from './gear.service';
import { RecordGearCheckDto, RosterQueryDto } from './dto';

/**
 * The gear-check table, for a staff account holding the `gear` role.
 *
 * INFORMATIONAL ONLY. No scoring or scheduling path reads `event_gear_checks`
 * and none may — a failed check does not stop a match. The result is shown
 * where the referee already looks, prominently enough that it cannot be missed
 * and passively enough that it stops nothing.
 */
@ApiTags('checkin')
@Controller('staff/gear')
export class GearController {
  constructor(private readonly gear: GearService) {}

  @Get('roster')
  @ApiOperation({
    summary: 'Search this event roster, each person expanded per entered weapon',
    description:
      'A pass is per weapon, so a fighter entered in longsword and rapier has two lines with independent results.',
  })
  async roster(@Query() query: RosterQueryDto, @Req() req: FastifyRequest) {
    return this.gear.searchGearRoster(req, query.q);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Fully-checked / total for this event',
    description:
      'A fighter counts as checked only when EVERY weapon they are entered in has a result — a longsword pass says nothing about the rapier they fight with after lunch.',
  })
  async summary(@Req() req: FastifyRequest) {
    return this.gear.getSummary(req);
  }

  @Get('match/:matchId')
  @ApiOperation({
    summary: "Both fighters' gear standing for one match, for this bout's weapon",
    description:
      'Readable by the piste as well as the gear table — the referee is who the result was always for. Scoped to the weapon of THIS bout: a longsword pass says nothing about the rapier after lunch. Informational; it gates nothing.',
  })
  @ApiParam({ name: 'matchId', type: 'string', format: 'uuid' })
  async matchGear(@Param('matchId', ParseUUIDPipe) matchId: string, @Req() req: FastifyRequest) {
    return this.gear.matchGear(req, matchId);
  }

  @Post(':personId/:weaponId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a pass / fail / conditional for one person and weapon',
    description:
      'Appends rather than overwriting, so a re-check after a failure keeps the history. A conditional without a reason is refused by both the DTO and a table CHECK.',
  })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'weaponId', type: 'string', format: 'uuid' })
  async record(
    @Param('personId', ParseUUIDPipe) personId: string,
    @Param('weaponId', ParseUUIDPipe) weaponId: string,
    @Body() dto: RecordGearCheckDto,
    @Req() req: FastifyRequest,
  ) {
    return this.gear.recordCheck(req, personId, weaponId, dto);
  }
}
