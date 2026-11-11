/**
 * fightbook.controller.ts — FightBook, slice 1 (docs/superpowers/specs/2026-11-10-fightbook-design.md)
 *
 * GET   /me/fightbook/settings  — the caller's switch, and whether they have a fighter profile
 * PATCH /me/fightbook/settings  — switch FightBook on or off
 * POST  /me/fightbook/requests  — ask a fighter for a spar
 * POST  /me/fightbook/requests/:id/answer   — yes, or "Not this time" with an optional comment
 * POST  /me/fightbook/requests/:id/withdraw — take back my request still waiting
 * POST  /me/fightbook/requests/:id/cancel   — cancel an agreed spar, either side
 * GET   /me/fightbook/inbox     — requests waiting for my answer
 * GET   /me/fightbook/spars     — my agreed spars, and the requests I sent
 *
 * Every route acts on the caller's own fighter profile, never on one a body names. Each handler
 * starts with `caller()`: 401 signed out, 403 a staff login or a guest token (the AuthGuard runs in
 * shadow mode, so each route refuses on its own).
 */
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
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ThrottleFightBookAsk } from '../../common/throttling/throttle-fightbook-ask';
import { SupabaseService } from '../supabase/supabase.service';
import { fightBookCaller, requireFightBookOn, type FightBookCaller } from './fightbook-caller';
import { FightBookSettingsService } from './fightbook-settings.service';
import { SparReadsService } from './spar-reads.service';
import { SparRequestsService } from './spar-requests.service';

const settingsSchema = z.object({ enabled: z.boolean() }).strict();
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

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: FightBookSettingsService,
    private readonly requests: SparRequestsService,
    private readonly reads: SparReadsService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: "The caller's FightBook switch, and whether they have a profile" })
  async getSettings(@Req() req: FastifyRequest) {
    return this.settings.get(await this.caller(req));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Switch FightBook on or off' })
  async setSettings(@Body() dto: FightBookSettingsDto, @Req() req: FastifyRequest) {
    return this.settings.set(await this.caller(req), dto.enabled);
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

  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take back my spar request still waiting' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.requests.withdraw(requireFightBookOn(await this.caller(req)), id);
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
    await this.requests.cancel(requireFightBookOn(await this.caller(req)), id, dto.message);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Spar requests waiting for my answer' })
  async inbox(@Req() req: FastifyRequest) {
    return this.reads.inbox(requireFightBookOn(await this.caller(req)));
  }

  @Get('spars')
  @ApiOperation({ summary: 'My agreed spars, and the requests I sent' })
  async spars(@Req() req: FastifyRequest) {
    return this.reads.mySpars(requireFightBookOn(await this.caller(req)));
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** The caller: 401 signed out, 403 not a personal account (fightbook-caller.ts). */
  private caller(req: FastifyRequest): Promise<FightBookCaller> {
    return fightBookCaller(req, this.supabase.service);
  }
}
