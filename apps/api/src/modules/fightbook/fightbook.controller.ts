/**
 * fightbook.controller.ts — FightBook, slice 1 (docs/superpowers/specs/2026-11-10-fightbook-design.md)
 *
 * GET   /me/fightbook/settings  — the caller's switch, and whether they have a fighter profile
 * PATCH /me/fightbook/settings  — save the switch, the stars, the daily limit
 * POST  /me/fightbook/requests  — ask a fighter for a spar
 * POST  /me/fightbook/requests/:id/answer   — yes, or "Not this time" with an optional comment
 * POST  /me/fightbook/requests/:id/withdraw — take back my request still waiting
 * POST  /me/fightbook/requests/:id/cancel   — cancel an agreed spar, either side
 * GET   /me/fightbook/inbox     — requests waiting for my answer
 * GET   /me/fightbook/blocks    — the fighters I blocked
 * POST  /me/fightbook/blocks    — block a fighter
 * DELETE /me/fightbook/blocks/:globalPersonId — unblock
 * GET   /me/fightbook/spars     — my agreed spars, and the requests I sent
 * GET   /me/fightbook/fighters/:globalPersonId/askable — may I ask this fighter
 * GET   /me/fightbook/events    — the Events I am on, with the days still open to ask for
 * GET   /me/fightbook/events/:eventId/askable?persons= — which of these people of an Event I may ask
 * GET   /me/fightbook/events/:eventId/find?weapon= — the fighters I may ask at an Event I am at
 * GET   /me/fightbook/find?q=&weapon=&page= — one page of all of FightBook I may ask
 *
 * Every route acts on the caller's own fighter profile, never on one a body names. Each handler
 * starts with `caller()`: 401 signed out, 403 a staff login or a guest token (the AuthGuard runs in
 * shadow mode, so each route refuses on its own).
 */
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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { publicReader } from '../../common/auth/competition-visibility';
import { ThrottleFightBookAsk } from '../../common/throttling/throttle-fightbook-ask';
import { SupabaseService } from '../supabase/supabase.service';
import {
  fightBookCaller,
  requireFightBookOn,
  requireProfile,
  type FightBookCaller,
} from './fightbook-caller';
import { FightBookBlocksService } from './fightbook-blocks.service';
import { FightBookSettingsService } from './fightbook-settings.service';
import { SparFindService } from './spar-find.service';
import { SparReadsService } from './spar-reads.service';
import { SparRequestsService } from './spar-requests.service';

export const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    showStars: z.boolean().optional(),
    dailyLimit: z.number().int().min(1).max(20).nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.enabled !== undefined || body.showStars !== undefined || body.dailyLimit !== undefined,
    { message: 'Say what to change' },
  );
class FightBookSettingsDto extends createZodDto(settingsSchema) {}

const text = (max: number) => z.string().trim().min(1).max(max);

/** One spar, several weapons (ruling 653); an Event day or a free date and place (648). */
export const askSchema = z
  .object({
    receiverGlobalPersonId: z.uuid(),
    kind: z.enum(['event', 'free']),
    eventId: z.uuid().optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    zone: z.string().min(1).max(64).optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    place: text(200).optional(),
    weapons: z.array(text(80)).min(1).max(5),
    message: text(500).optional(),
  })
  .strict()
  .refine(
    (ask) =>
      ask.kind === 'event'
        ? ask.eventId !== undefined && ask.place === undefined
        : ask.eventId === undefined,
    { message: 'An Event spar names its Event and no place; a free date names no Event' },
  );
class AskSparDto extends createZodDto(askSchema) {}

/** A comment goes with a "Not this time" only; it stays private unless shown (ruling 644). */
const answerSchema = z
  .object({
    answer: z.enum(['yes', 'no']),
    comment: text(500).optional(),
    showComment: z.boolean().optional(),
  })
  .strict();
class AnswerSparDto extends createZodDto(answerSchema) {}

const cancelSchema = z.object({ message: text(500).optional() }).strict();
class CancelSparDto extends createZodDto(cancelSchema) {}

const blockSchema = z.object({ globalPersonId: z.uuid() }).strict();
class BlockDto extends createZodDto(blockSchema) {}

/** The roster rows a people page shows: 1 to 50 `persons` ids, comma-separated. */
export const askableQuerySchema = z
  .object({
    persons: z
      .string()
      .transform((raw) => raw.split(','))
      .pipe(z.array(z.uuid()).min(1).max(50)),
  })
  .strict();
class AskableQueryDto extends createZodDto(askableQuerySchema) {}

/** Find's weapon filter: a catalog weapon id, as `GET /weapons?active=true` lists them. */
export const findQuerySchema = z.object({ weapon: z.uuid().optional() }).strict();
class FindQueryDto extends createZodDto(findQuerySchema) {}

/** All of FightBook (ruling 675): a name, a weapon, and a 0-based page of 20. */
export const browseQuerySchema = z
  .object({
    q: z.string().max(80).optional(),
    weapon: z.uuid().optional(),
    page: z.coerce.number().int().min(0).max(500).default(0),
  })
  .strict();
class BrowseQueryDto extends createZodDto(browseQuerySchema) {}

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: FightBookSettingsService,
    private readonly requests: SparRequestsService,
    private readonly reads: SparReadsService,
    private readonly blocks: FightBookBlocksService,
    private readonly find: SparFindService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: "The caller's FightBook switch, and whether they have a profile" })
  async getSettings(@Req() req: FastifyRequest) {
    return this.settings.get(await this.caller(req));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Switch FightBook on or off' })
  async setSettings(@Body() dto: FightBookSettingsDto, @Req() req: FastifyRequest) {
    return this.settings.set(await this.caller(req), dto);
  }

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookAsk()
  @ApiOperation({ summary: 'Ask a fighter for a spar' })
  async ask(@Body() dto: AskSparDto, @Req() req: FastifyRequest) {
    const caller = await this.caller(req);
    return this.requests.ask(requireFightBookOn(caller), dto);
  }

  @Post('requests/:id/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer a spar request: yes, or not this time' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerSparDto,
    @Req() req: FastifyRequest,
  ) {
    return this.requests.answer(requireFightBookOn(await this.caller(req)), id, dto);
  }

  // Take back, My spars and cancel need a profile, not the switch (ruling 666): a fighter who
  // switched off still sees the spars they agreed and can call one off, and can pull back a
  // request a half-failed switch-off left waiting. None of them reaches anyone new.
  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take back my spar request still waiting' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.requests.withdraw(requireProfile(await this.caller(req)), id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an agreed spar' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSparDto,
    @Req() req: FastifyRequest,
  ) {
    await this.requests.cancel(requireProfile(await this.caller(req)), id, dto.message);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Spar requests waiting for my answer' })
  async inbox(@Req() req: FastifyRequest) {
    return this.reads.inbox(requireFightBookOn(await this.caller(req)));
  }

  @Get('spars')
  @ApiOperation({ summary: 'My agreed spars, and the requests I sent' })
  async spars(@Req() req: FastifyRequest) {
    const caller = await this.caller(req);
    return this.reads.mySpars(requireProfile(caller), caller.enabled);
  }

  // Blocks need a profile, not the switch: a fighter who turned FightBook off still manages them.
  @Get('blocks')
  @ApiOperation({ summary: 'The fighters I blocked in FightBook' })
  async listBlocks(@Req() req: FastifyRequest) {
    return this.blocks.list(requireProfile(await this.caller(req)));
  }

  @Post('blocks')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Block a fighter in FightBook' })
  async block(@Body() dto: BlockDto, @Req() req: FastifyRequest) {
    await this.blocks.block(requireProfile(await this.caller(req)), dto.globalPersonId);
  }

  @Delete('blocks/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a fighter in FightBook' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async unblock(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.blocks.unblock(requireProfile(await this.caller(req)), globalPersonId);
  }

  @Get('fighters/:globalPersonId/askable')
  @ApiOperation({ summary: 'May I ask this fighter for a spar' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async askableFighter(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const me = requireFightBookOn(await this.caller(req));
    return this.find.askableFighter(me, globalPersonId);
  }

  @Get('events')
  @ApiOperation({ summary: 'The published Events I am on, with the days still open to ask for' })
  async myEvents(@Req() req: FastifyRequest) {
    return this.find.myEvents(requireFightBookOn(await this.caller(req)));
  }

  @Get('events/:eventId/askable')
  @ApiOperation({ summary: 'Which of these people of an Event I may ask for a spar' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async askableAtEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: AskableQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const me = requireFightBookOn(await this.caller(req));
    return this.find.askableAtEvent(me, eventId, query.persons, publicReader(req));
  }

  @Get('events/:eventId/find')
  @ApiOperation({ summary: 'The fighters I may ask at an Event I am at' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async findAtEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: FindQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const me = requireFightBookOn(await this.caller(req));
    return this.find.atEvent(me, eventId, query.weapon, publicReader(req));
  }

  @Get('find')
  @ApiOperation({ summary: 'One page of the FightBook users I may ask' })
  async browse(@Query() query: BrowseQueryDto, @Req() req: FastifyRequest) {
    const me = requireFightBookOn(await this.caller(req));
    return this.find.browse(me, query.q, query.weapon, query.page);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** The caller: 401 signed out, 403 not a personal account (fightbook-caller.ts). */
  private caller(req: FastifyRequest): Promise<FightBookCaller> {
    return fightBookCaller(req, this.supabase.service);
  }
}
