/**
 * privacy.controller.ts — T-609
 *
 * GET  /api/v1/persons/me/privacy  — get own privacy prefs (auto-creates defaults)
 * PATCH /api/v1/persons/me/privacy — update own privacy prefs
 *
 * Only the Person themselves (claimed account) can write.
 * Super admin can read via admin endpoints (not this controller).
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
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService } from './privacy.service';

const updatePrivacySchema = z
  .object({
    hideWorkshopsPublicly: z.boolean().optional(),
    allowBeingFollowed: z.boolean().optional(),
    showRealEmailToFollowers: z.boolean().optional(),
  })
  .strict();
class UpdatePrivacyDto extends createZodDto(updatePrivacySchema) {}

@ApiTags('persons')
@Controller('persons/me')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('privacy')
  @ApiOperation({ summary: 'Get own privacy preferences (auto-creates defaults)' })
  @ApiResponse({ status: 200, description: 'Privacy preferences' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getPrivacy(@Req() req: FastifyRequest) {
    const personId = await this.resolvePersonId(req);
    return this.privacy.getOrCreate(personId);
  }

  @Patch('privacy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own privacy preferences' })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updatePrivacy(@Req() req: FastifyRequest, @Body() dto: UpdatePrivacyDto) {
    const personId = await this.resolvePersonId(req);
    return this.privacy.update(personId, {
      hideWorkshopsPublicly: dto.hideWorkshopsPublicly,
      allowBeingFollowed: dto.allowBeingFollowed,
      showRealEmailToFollowers: dto.showRealEmailToFollowers,
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Resolve the person_id for the authenticated user.
   * Requires a claimed session (Supabase JWT cookie).
   * Guest sessions cannot manage privacy prefs.
   */
  private async resolvePersonId(req: FastifyRequest): Promise<string> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const accessToken = cookies?.['sb-access-token'];

    if (!accessToken) {
      throw new UnauthorizedException('Authentication required to manage privacy preferences');
    }

    // Verify token and get user
    const { data, error } = await this.supabase.anon.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Find person claimed by this user
    const { data: person } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('claimed_by_user_id', data.user.id)
      .maybeSingle();

    if (!person) {
      throw new UnauthorizedException('No person profile linked to this account');
    }

    return (person as { id: string }).id;
  }
}
