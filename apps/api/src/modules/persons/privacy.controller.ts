/**
 * privacy.controller.ts — T-609
 *
 * GET  /api/v1/persons/me/privacy  — get own privacy prefs (on the global person, ruling 132)
 * PATCH /api/v1/persons/me/privacy — update own privacy prefs
 *
 * Only the Person themselves (claimed account) can write.
 * Super admin can read via admin endpoints (not this controller).
 *
 * "People may follow me" saved as off also removes the people who already follow her (ruling 208,
 * `followers-removal.ts`).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { removeFollowersOf } from '../follows/followers-removal';
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService, type PersonPrivacy } from './privacy.service';

const updatePrivacySchema = z
  .object({
    hideWorkshopsPublicly: z.boolean().optional(),
    allowBeingFollowed: z.boolean().optional(),
  })
  .strict();
class UpdatePrivacyDto extends createZodDto(updatePrivacySchema) {}

@ApiTags('persons')
@Controller('persons/me')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly supabase: SupabaseService,
    private readonly followAlerts: FollowNotificationSchedulerService,
  ) {}

  @Get('privacy')
  @ApiOperation({ summary: 'Get own privacy preferences' })
  @ApiResponse({ status: 200, description: 'Privacy preferences' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getPrivacy(@Req() req: FastifyRequest) {
    return this.found(await this.privacy.forUser(await this.authenticate(req)));
  }

  @Patch('privacy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own privacy preferences' })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updatePrivacy(@Req() req: FastifyRequest, @Body() dto: UpdatePrivacyDto) {
    const userId = await this.authenticate(req);
    const saved = this.found(
      await this.privacy.updateForUser(userId, {
        hideWorkshopsPublicly: dto.hideWorkshopsPublicly,
        allowBeingFollowed: dto.allowBeingFollowed,
      }),
    );
    // Off removes the people who already follow her (ruling 208), once the choice is saved so no
    // new follow lands. On EVERY save that says off, not only the one that changes it: when this
    // fails the choice is already off, the page puts its switch back, and her next tap sends
    // "off" again. (After a reload the page reads off, and the repair is on, then off.)
    if (dto.allowBeingFollowed === false) {
      await removeFollowersOf({ supabase: this.supabase, alerts: this.followAlerts }, userId);
    }
    return saved;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * The choices live on the user's global person (ruling 132), which is unique on the account
   * (0063). A user with none has nowhere to store an answer. That is a data-model limit, not an
   * auth failure, but 401 is what the surface has always returned and the settings page handles
   * it.
   */
  private found(privacy: PersonPrivacy | null): PersonPrivacy {
    if (!privacy) throw new UnauthorizedException('No person profile linked to this account');
    return privacy;
  }

  /** The Supabase user behind the session cookie. Guest sessions have none. */
  private async authenticate(req: FastifyRequest): Promise<string> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const accessToken = cookies?.['sb-access-token'];

    if (!accessToken) {
      throw new UnauthorizedException('Authentication required to manage privacy preferences');
    }

    const user = await this.supabase.getAuthUser(accessToken);
    if (!user) throw new UnauthorizedException('Invalid or expired session');
    return user.id;
  }
}
