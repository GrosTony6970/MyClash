/**
 * fightbook-after.controller.ts — FightBook, slice 3: after the spar.
 *
 * POST /me/fightbook/requests/:id/done — "We sparred": mark an agreed spar done, either fighter
 * POST /me/fightbook/requests/:id/undo — put a done spar back to agreed, either fighter
 *
 * Each handler starts with `caller()`, as the first FightBook controller does. A profile is enough,
 * not the switch (ruling 666): a fighter who switched off still finishes the spars they agreed.
 */
import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { fightBookCaller, requireProfile, type FightBookCaller } from './fightbook-caller';
import { SparAfterService } from './spar-after.service';

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookAfterController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly after: SparAfterService,
  ) {}

  @Post('requests/:id/done')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark an agreed spar as done: we sparred' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async done(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.after.markDone(requireProfile(await this.caller(req)), id);
  }

  @Post('requests/:id/undo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Undo "We sparred": the spar is agreed again' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async undo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.after.undo(requireProfile(await this.caller(req)), id);
  }

  /** The caller: 401 signed out, 403 not a personal account (fightbook-caller.ts). */
  private caller(req: FastifyRequest): Promise<FightBookCaller> {
    return fightBookCaller(req, this.supabase.service);
  }
}
