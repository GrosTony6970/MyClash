import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { publicReader } from '../../common/auth/competition-visibility';
import { BlockOnCompletedEvent } from '../../common/event-readonly/block-on-completed.decorator';
import { AuthService } from '../auth/auth.service';
import { JoinEventDto } from './dto/persons.dto';
import { EventJoinService, type JoinOutcome } from './event-join.service';

/**
 * A signed-in account puts itself on an Event's list from a Workshop page (rulings 516, 567,
 * 568). Under `me/`: the caller acts for itself. Placed by its Event: no join at a completed
 * (573) or archived Event.
 */
@ApiTags('me')
@ApiCookieAuth('sb-access-token')
@Controller()
export class EventJoinController {
  constructor(
    private readonly auth: AuthService,
    private readonly joins: EventJoinService,
  ) {}

  @Post('me/events/:eventId/join')
  @HttpCode(HttpStatus.OK)
  @BlockOnCompletedEvent()
  @ApiOperation({ summary: "Put one's own account on an Event's list (the Event allows it)" })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiResponse({ status: 200, description: '{ personId, joined: new | claimed | already }' })
  @ApiResponse({ status: 400, description: '`NamesRequired`: the account has no profile' })
  @ApiResponse({ status: 401, description: 'No signed-in account (a guest session is none)' })
  @ApiResponse({ status: 404, description: 'Unknown Event, or one this caller may not see' })
  @ApiResponse({
    status: 409,
    description:
      '`SelfJoinClosed`, or `AskOrganiser` with `reason`: sameName | yourProfile | yourAddress',
  })
  async join(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: JoinEventDto,
    @Req() req: FastifyRequest,
  ): Promise<JoinOutcome> {
    const account = await this.auth.requireAccount(req);
    return this.joins.join(eventId, account, publicReader(req), dto);
  }
}
