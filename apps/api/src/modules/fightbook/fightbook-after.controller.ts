/**
 * fightbook-after.controller.ts — FightBook, slice 3: after the spar.
 *
 * POST /me/fightbook/requests/:id/done — "We sparred": mark an agreed spar done, either fighter
 * POST /me/fightbook/requests/:id/undo — put a done spar back to agreed, either fighter
 * POST /me/fightbook/requests/:id/review — a thank-you, or an anonymous review, on a done spar
 * PUT  /me/fightbook/requests/:id/note — my private note on a done spar; null deletes it
 * GET  /me/fightbook/thanks?page= — the signed thank-yous I received, newest first
 * GET|PUT|DELETE /me/fightbook/favourites[/:globalPersonId] — my private hearts (FightBook on)
 *
 * Each handler starts with `caller()`, as the first FightBook controller does. A profile is enough,
 * not the switch (ruling 666): a fighter who switched off still finishes the spars they agreed.
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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SupabaseService } from '../supabase/supabase.service';
import {
  fightBookCaller,
  requireFightBookOn,
  requireProfile,
  type FightBookCaller,
} from './fightbook-caller';
import { FightBookFavouritesService } from './fightbook-favourites.service';
import { SparAfterService } from './spar-after.service';
import { SparThanksService } from './spar-thanks.service';

/** Trimmed BEFORE the length check: a text of only spaces, tabs or newlines is refused. */
const text = z.string().trim().min(1).max(500);

/**
 * 1 to 5 stars, an optional text, signed or anonymous (rulings 683, 690). Checked here, before the
 * database: `fightbook_review` would answer a missing or out-of-range star or a long text with a
 * raw constraint error, a 5xx.
 */
export const reviewSchema = z
  .object({ stars: z.int().min(1).max(5), text: text.optional(), anonymous: z.boolean() })
  .strict();
class ReviewDto extends createZodDto(reviewSchema) {}

/** The note's text, or null to delete it. */
export const noteSchema = z.object({ body: text.nullable() }).strict();
class NoteDto extends createZodDto(noteSchema) {}

/** A 0-based page of 20 thank-yous. */
export const thanksQuerySchema = z
  .object({ page: z.coerce.number().int().min(0).max(500).default(0) })
  .strict();
class ThanksQueryDto extends createZodDto(thanksQuerySchema) {}

@ApiTags('fightbook')
@Controller('me/fightbook')
export class FightBookAfterController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly after: SparAfterService,
    private readonly thanks: SparThanksService,
    private readonly favouritesService: FightBookFavouritesService,
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

  @Post('requests/:id/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thank the partner of a done spar, or review them anonymously' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @Req() req: FastifyRequest,
  ) {
    await this.after.review(requireProfile(await this.caller(req)), id, dto);
  }

  @Put('requests/:id/note')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Write, replace or delete my private note on a done spar' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async note(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
    @Req() req: FastifyRequest,
  ) {
    await this.after.setNote(requireProfile(await this.caller(req)), id, dto.body);
  }

  @Get('thanks')
  @ApiOperation({ summary: 'The thank-yous I received, newest first, 20 a page' })
  async receivedThanks(@Query() query: ThanksQueryDto, @Req() req: FastifyRequest) {
    return this.thanks.received(requireProfile(await this.caller(req)), query.page);
  }

  // Favourites need the switch on (ruling 679): a private heart on someone you can ask.
  @Get('favourites')
  @ApiOperation({ summary: 'My favourite FightBook users, by name' })
  async favourites(@Req() req: FastifyRequest) {
    return this.favouritesService.list(requireFightBookOn(await this.caller(req)));
  }

  @Put('favourites/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Heart a FightBook user' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async addFavourite(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.favouritesService.add(requireFightBookOn(await this.caller(req)), globalPersonId);
  }

  @Delete('favourites/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take the heart off a FightBook user' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async removeFavourite(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.favouritesService.remove(requireFightBookOn(await this.caller(req)), globalPersonId);
  }

  /** The caller: 401 signed out, 403 not a personal account (fightbook-caller.ts). */
  private caller(req: FastifyRequest): Promise<FightBookCaller> {
    return fightBookCaller(req, this.supabase.service);
  }
}
