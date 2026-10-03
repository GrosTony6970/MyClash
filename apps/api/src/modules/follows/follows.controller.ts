/**
 * follows.controller.ts — T-610
 *
 * GET    /events/:eventId/follows          — list follows for session
 * POST   /events/:eventId/follows          — follow a person (idempotent)
 * DELETE /events/:eventId/follows/:personId — unfollow
 * PATCH  /me/follows/by-global-person/:globalPersonId — the hub follow's own switch (ruling 217)
 * PATCH  /me/follows/by-global-person/:globalPersonId/events — a Following card's three
 *        switches, on every coming Event follow of that person (ruling 239)
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
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { publicReader } from '../../common/auth/competition-visibility';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveFollowIdentity } from './follow-identity';
import { type FollowIdentity, FollowsService } from './follows.service';
import { OrganizationFollowsService } from './organization-follows.service';

const followSchema = z
  .object({
    personId: z.uuid(),
  })
  .strict();
class FollowDto extends createZodDto(followSchema) {}

/** A tap on a card of the Following tab (ruling 239): at least one of its three switches. */
export const cardSwitchesSchema = z
  .object({
    notifyMatchStart: z.boolean().optional(),
    notifyWorkshopStart: z.boolean().optional(),
    notifyRefereeStart: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Name at least one switch',
  });
class UpdateCardSwitchesDto extends createZodDto(cardSwitchesSchema) {}

const followByGlobalPersonSchema = z
  .object({
    globalPersonId: z.uuid(),
  })
  .strict();
class FollowByGlobalPersonDto extends createZodDto(followByGlobalPersonSchema) {}

/** The hub follow has ONE switch (ruling 217a): tell me before he referees. */
export const hubFollowSchema = z
  .object({
    notifyRefereeStart: z.boolean(),
  })
  .strict();
class UpdateHubFollowDto extends createZodDto(hubFollowSchema) {}

const followOrganizationSchema = z
  .object({
    organizationId: z.uuid(),
  })
  .strict();
class FollowOrganizationDto extends createZodDto(followOrganizationSchema) {}

@ApiTags('follows')
@Controller()
export class FollowsController {
  constructor(
    private readonly follows: FollowsService,
    private readonly orgFollows: OrganizationFollowsService,
    private readonly guestJwt: GuestJwtService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/follows')
  @ApiOperation({ summary: 'List follows for current session' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const identity = await this.resolveIdentity(req);
    return this.follows.listFollows(eventId, identity, publicReader(req));
  }

  @Get('me/follows')
  @ApiOperation({ summary: "List all of the current session's follows across events" })
  async listAll(@Req() req: FastifyRequest) {
    const identity = await this.resolveIdentity(req);
    return this.follows.listAllFollows(identity);
  }

  @Post('me/follows/by-global-person')
  @ApiOperation({
    summary: 'Follow a global person across all their current/upcoming events',
  })
  async followByGlobalPerson(@Body() dto: FollowByGlobalPersonDto, @Req() req: FastifyRequest) {
    const identity = await this.resolveIdentity(req);
    return this.follows.followAllEvents(dto.globalPersonId, identity);
  }

  @Delete('me/follows/by-global-person/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfollow a global person across all their events' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async unfollowByGlobalPerson(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const identity = await this.resolveIdentity(req);
    await this.follows.unfollowAllEvents(globalPersonId, identity);
  }

  // Accounts only, as the organisation follows below: a hub follow is an account's, and the
  // alert it asks for needs an identity to deliver to.
  @Patch('me/follows/by-global-person/:globalPersonId')
  @ApiOperation({
    summary: 'Set the hub follow switch: notify before this person referees',
  })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async updateHubFollow(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Body() dto: UpdateHubFollowDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.requireUserId(req, 'set this alert');
    return this.follows.setHubRefereeAlert(globalPersonId, userId, dto.notifyRefereeStart);
  }

  // Accounts only, as the hub switch above: the Following tab is an account's, and a guest
  // session has no card.
  @Patch('me/follows/by-global-person/:globalPersonId/events')
  @ApiOperation({
    summary: "Set a Following card's switches on every coming Event follow of this person",
  })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async updateCardSwitches(
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Body() dto: UpdateCardSwitchesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.requireUserId(req, 'set this alert');
    return this.follows.setCardSwitches(globalPersonId, userId, {
      notifyMatchStart: dto.notifyMatchStart,
      notifyWorkshopStart: dto.notifyWorkshopStart,
      notifyRefereeStart: dto.notifyRefereeStart,
    });
  }

  // ── Organisation follows ─────────────────────────────────────────────────────
  // Claimed users only: the payoff is a push/email notification, which needs an
  // identity to deliver to. A guest session has none, so these 401 rather than
  // silently recording a follow that can never fire.

  @Get('me/follows/organizations')
  @ApiOperation({ summary: 'List the organisations the current user follows' })
  async listFollowedOrganizations(@Req() req: FastifyRequest) {
    const userId = await this.requireUserId(req);
    return this.orgFollows.list(userId);
  }

  @Post('me/follows/organizations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Follow an organisation (idempotent)' })
  async followOrganization(@Body() dto: FollowOrganizationDto, @Req() req: FastifyRequest) {
    const userId = await this.requireUserId(req);
    return this.orgFollows.follow(userId, dto.organizationId);
  }

  @Delete('me/follows/organizations/:organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfollow an organisation' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  async unfollowOrganization(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.requireUserId(req);
    await this.orgFollows.unfollow(userId, organizationId);
  }

  @Post('events/:eventId/follows')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Follow a person (idempotent)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async follow(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: FollowDto,
    @Req() req: FastifyRequest,
  ) {
    const identity = await this.resolveIdentity(req);
    return this.follows.followInEvent(eventId, dto.personId, identity, publicReader(req));
  }

  @Delete('events/:eventId/follows/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfollow a person' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async unfollow(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    const identity = await this.resolveIdentity(req);
    await this.follows.unfollow(eventId, personId, identity);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Like resolveIdentity, but rejects guests. Organisation follows exist to be
   * notified, and there is nowhere to deliver a notification for a guest
   * session — better a 401 than a follow row that can never fire. `what` ends the 401's
   * sentence: what the caller must sign in for.
   */
  private async requireUserId(
    req: FastifyRequest,
    what = 'follow an organisation',
  ): Promise<string> {
    const identity = await this.resolveIdentity(req);
    if (!identity.userId) throw new UnauthorizedException(`Sign in to ${what}`);
    return identity.userId;
  }

  private resolveIdentity(req: FastifyRequest): Promise<FollowIdentity> {
    return resolveFollowIdentity(req, this.supabase, this.guestJwt);
  }
}
