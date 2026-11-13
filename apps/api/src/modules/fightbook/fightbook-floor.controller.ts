/**
 * fightbook-floor.controller.ts — FightBook slice 5, the floor tools
 * (docs/superpowers/plans: 2026-11-13-fightbook-slice5-floor)
 *
 * PUT    /me/fightbook/events/:eventId/free  — "Free to spar now" for an hour at an Event I am at
 * DELETE /me/fightbook/events/:eventId/free  — no longer free
 * GET    /me/fightbook/events/:eventId/calls — today's open calls there: mine, and the others
 * POST   /me/fightbook/events/:eventId/calls — post an open call ("Longsword at 15:00")
 * DELETE /me/fightbook/calls/:id             — close my open call
 * PUT    /me/fightbook/calls/:id/answer      — "I'm in"
 * DELETE /me/fightbook/calls/:id/answer      — take my "I'm in" back
 * POST   /me/fightbook/calls/:id/pick        — pick an answer of my call: the spar is agreed
 * POST   /me/fightbook/qr                    — a new code for my FightBook QR (five minutes)
 * POST   /me/fightbook/qr/scan               — scan a fighter's QR: a spar request to them, today
 *
 * Every route acts on the caller's own fighter profile. A route that adds presence (switching
 * on, reading or posting calls, answering, picking, showing or scanning a QR) needs FightBook on; one that removes it
 * (switching off, closing, taking back) needs a profile only, so an off fighter can always
 * withdraw.
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
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ThrottleFightBookCall } from '../../common/throttling/throttle-fightbook-call';
import { ThrottleFightBookQrMint } from '../../common/throttling/throttle-fightbook-qr-mint';
import { ThrottleFightBookScan } from '../../common/throttling/throttle-fightbook-scan';
import { SupabaseService } from '../supabase/supabase.service';
import { fightBookCaller, requireFightBookOn, requireProfile } from './fightbook-caller';
import { FreeNowService } from './free-now.service';
import { OpenCallsService } from './open-calls.service';
import { SparQrService } from './spar-qr.service';

/** An open call: 1 to 5 catalog weapons and a time today, `HH:MM` on the Event's clock. */
export const postCallSchema = z
  .object({
    weapons: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();
class PostCallDto extends createZodDto(postCallSchema) {}

/** The fighter picked among the call's answers. */
export const pickSchema = z.object({ globalPersonId: z.uuid() }).strict();
class PickDto extends createZodDto(pickSchema) {}

/**
 * A scan (ruling 709): the code the camera read, 1 to 5 catalog weapons, and the Event both are
 * at, or a place and the phone's zone. Any text is a code here: one that is not ours is the
 * service's 400 `bad_code`.
 */
export const scanSchema = z
  .object({
    code: z.string().trim().min(1).max(200),
    weapons: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
    eventId: z.uuid().optional(),
    place: z.string().trim().min(1).max(200).optional(),
    zone: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((scan) => scan.eventId === undefined || scan.place === undefined, {
    message: 'An Event spar names its Event and no place',
  });
class ScanDto extends createZodDto(scanSchema) {}

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookFloorController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly freeNow: FreeNowService,
    private readonly calls: OpenCallsService,
    private readonly qr: SparQrService,
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

  @Get('events/:eventId/calls')
  @ApiOperation({ summary: "Today's open calls at an Event I am at: mine, and the others" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async readCalls(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.calls.read(requireFightBookOn(caller), eventId);
  }

  // Throttled in its own bucket, apart from the asks (Ruling L): the cap bounds OPEN calls only,
  // so without it a post-then-close loop would insert rows without a bound (Decision 6).
  @Post('events/:eventId/calls')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookCall()
  @ApiOperation({ summary: 'Post an open call for a spar today at an Event I am at' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async postCall(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: PostCallDto,
    @Req() req: FastifyRequest,
  ) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.calls.post(requireFightBookOn(caller), eventId, dto);
  }

  @Delete('calls/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close my open call' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async closeCall(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    await this.calls.close(requireProfile(caller), id);
  }

  @Put('calls/:id/answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Answer an open call: I'm in" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async answerCall(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    await this.calls.answer(requireFightBookOn(caller), id);
  }

  @Delete('calls/:id/answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Take back my I'm in on an open call" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async takeBackAnswer(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    await this.calls.takeBack(requireProfile(caller), id);
  }

  @Post('calls/:id/pick')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pick an answer of my open call: the spar is agreed' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async pickAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PickDto,
    @Req() req: FastifyRequest,
  ) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.calls.pick(requireFightBookOn(caller), id, dto.globalPersonId);
  }

  // Each in its own bucket, apart from the asks (Ruling L): sixty codes and twenty scans an hour.
  @Post('qr')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookQrMint()
  @ApiOperation({ summary: 'A new code for my FightBook QR: five minutes, one scan' })
  async mintQr(@Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.qr.mint(requireFightBookOn(caller));
  }

  @Post('qr/scan')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookScan()
  @ApiOperation({ summary: "Scan a fighter's FightBook QR: a spar request to them, today" })
  async scanQr(@Body() dto: ScanDto, @Req() req: FastifyRequest) {
    const caller = await fightBookCaller(req, this.supabase.service);
    return this.qr.scan(requireFightBookOn(caller), dto);
  }
}
