/**
 * follows.controller.ts — T-610
 *
 * GET    /events/:eventId/follows          — list follows for session
 * POST   /events/:eventId/follows          — follow a person (idempotent)
 * DELETE /events/:eventId/follows/:personId — unfollow
 * PATCH  /events/:eventId/follows/:personId — update notification prefs
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
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { SupabaseService } from '../supabase/supabase.service';
import { type FollowIdentity, FollowsService } from './follows.service';

const followSchema = z
  .object({
    personId: z.uuid(),
  })
  .strict();
class FollowDto extends createZodDto(followSchema) {}

const updateFollowSchema = z
  .object({
    notifyMatchStart: z.boolean().optional(),
    notifyWorkshopStart: z.boolean().optional(),
  })
  .strict();
class UpdateFollowDto extends createZodDto(updateFollowSchema) {}

@ApiTags('follows')
@Controller()
export class FollowsController {
  constructor(
    private readonly follows: FollowsService,
    private readonly guestJwt: GuestJwtService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/follows')
  @ApiOperation({ summary: 'List follows for current session' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const identity = await this.resolveIdentity(req);
    return this.follows.listFollows(eventId, identity);
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
    return this.follows.follow(eventId, dto.personId, identity);
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

  @Patch('events/:eventId/follows/:personId')
  @ApiOperation({ summary: 'Update follow notification preferences' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async updateNotifications(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: UpdateFollowDto,
    @Req() req: FastifyRequest,
  ) {
    const identity = await this.resolveIdentity(req);
    return this.follows.updateNotifications(eventId, personId, identity, {
      notifyMatchStart: dto.notifyMatchStart,
      notifyWorkshopStart: dto.notifyWorkshopStart,
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async resolveIdentity(req: FastifyRequest): Promise<FollowIdentity> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;

    // Try claimed user first
    const accessToken = cookies?.['sb-access-token'];
    if (accessToken) {
      const { data } = await this.supabase.anon.auth.getUser(accessToken);
      if (data.user) return { userId: data.user.id };
    }

    // Try guest session
    const guestToken = cookies?.['mc_guest'];
    if (guestToken) {
      try {
        const payload = this.guestJwt.verify(guestToken);
        return { guestSessionId: payload.sub };
      } catch {
        // Invalid token — anonymous
      }
    }

    return {};
  }
}
