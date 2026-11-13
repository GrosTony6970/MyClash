/**
 * fightbook-floor.controller.ts — FightBook slice 5, the floor tools
 * (docs/superpowers/plans: 2026-11-13-fightbook-slice5-floor)
 *
 * PUT    /me/fightbook/events/:eventId/free — "Free to spar now" for an hour at an Event I am at
 * DELETE /me/fightbook/events/:eventId/free — no longer free
 *
 * Every route acts on the caller's own fighter profile. Switching on adds presence, so it needs
 * FightBook on; switching off removes it, so a profile is enough and an off fighter can always
 * withdraw.
 */
import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { fightBookCaller, requireFightBookOn, requireProfile } from './fightbook-caller';
import { FreeNowService } from './free-now.service';

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookFloorController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly freeNow: FreeNowService,
  ) {}

  @Put('events/:eventId/free')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Be free to spar now at an Event I am at, for an hour' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async switchOn(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.freeNow.switchOn(requireFightBookOn(caller), eventId);
  }

  @Delete('events/:eventId/free')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop being free to spar now at an Event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async switchOff(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    await this.freeNow.switchOff(requireProfile(caller), eventId);
  }
}
