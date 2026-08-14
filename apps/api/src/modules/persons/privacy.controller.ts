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
  InternalServerErrorException,
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
    const personIds = await this.resolvePersonIds(req);
    return this.privacy.getOrCreateForPersons(personIds);
  }

  @Patch('privacy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own privacy preferences' })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updatePrivacy(@Req() req: FastifyRequest, @Body() dto: UpdatePrivacyDto) {
    const personIds = await this.resolvePersonIds(req);
    return this.privacy.updateForPersons(personIds, {
      hideWorkshopsPublicly: dto.hideWorkshopsPublicly,
      allowBeingFollowed: dto.allowBeingFollowed,
      showRealEmailToFollowers: dto.showRealEmailToFollowers,
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Every `persons` row the authenticated user owns, oldest first.
   *
   * A LIST, not one id, because `persons` is EVENT-SCOPED: a competitor who has
   * entered five events has five rows, and `person_privacy.person_id` references
   * `persons(id)`, so their single privacy answer is stored five times over.
   *
   * This used to be `.maybeSingle()` on `persons.claimed_by_user_id`, which has
   * no unique index (only `global_persons` does, 0063). PostgREST answers a
   * multi-row `maybeSingle` with PGRST116 and a null row; the error was not even
   * destructured, so the null fell through to "No person profile linked to this
   * account" and anyone in two or more events was permanently locked out of
   * their own privacy settings by a 401 that was not true.
   *
   * Resolution goes through `global_persons`, which is the actual identity and
   * does carry a unique index on `claimed_by_user_id`. The `persons` rows are
   * then found by that identity — plus any claimed directly, for rows written
   * before global linkage existed.
   */
  private async resolvePersonIds(req: FastifyRequest): Promise<string[]> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const accessToken = cookies?.['sb-access-token'];

    if (!accessToken) {
      throw new UnauthorizedException('Authentication required to manage privacy preferences');
    }

    const { data, error } = await this.supabase.anon.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const userId = data.user.id;

    // global_persons.claimed_by_user_id is UNIQUE (0063), so this one IS single.
    const { data: globalPerson, error: globalError } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();

    // A query failure is a 500, not "you have no profile". Swallowing it is what
    // made the original defect invisible for as long as it was.
    if (globalError) {
      throw new InternalServerErrorException('Could not resolve your profile');
    }

    const globalPersonId = (globalPerson as { id: string } | null)?.id ?? null;

    let personsQuery = this.supabase.service
      .from('persons')
      .select('id')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    personsQuery = globalPersonId
      ? (personsQuery.or(
          `claimed_by_user_id.eq.${userId},global_person_id.eq.${globalPersonId}`,
        ) as typeof personsQuery)
      : (personsQuery.eq('claimed_by_user_id', userId) as typeof personsQuery);

    const { data: persons, error: personsError } = await personsQuery;
    if (personsError) {
      throw new InternalServerErrorException('Could not resolve your profile');
    }

    const ids = [...new Set(((persons ?? []) as Array<{ id: string }>).map((p) => p.id))];

    if (ids.length === 0) {
      // Genuinely no profile: person_privacy.person_id is a foreign key to
      // persons, so a user who has never entered an event has nowhere to store
      // an answer. That is a data-model limit, not an auth failure, but 401 is
      // what the surface has always returned and the settings page handles it.
      throw new UnauthorizedException('No person profile linked to this account');
    }

    return ids;
  }
}
