/**
 * settings.controller.ts — T-902
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { assertCanManageEvent, assertEventMember } from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from './settings.service';

const updateSettingsSchema = z
  .object({
    enforceSchoolSeparation: z.boolean().optional(),
    schoolSeparationStrictness: z.enum(['hard', 'soft']).optional(),
    enforceSkillBalance: z.boolean().optional(),
    // enforce_fighter_referee_no_overlap is NOT in this DTO — it cannot be changed
    enforceRefereeNoBackToBack: z.boolean().optional(),
    refereeRestMinSlots: z.number().int().min(0).max(5).optional(),
    enforceDedicatedRefereeRest: z.boolean().optional(),
    workshopConflictWarning: z.boolean().optional(),
    ratingBasedOrdering: z.boolean().optional(),
    workloadBalance: z.boolean().optional(),
    // Per-rule toggles for the Assignment Health rules (all default true).
    enableOwnPoolRule: z.boolean().optional(),
    enableOfficiateVsFightRule: z.boolean().optional(),
    enableDoubleBookedRule: z.boolean().optional(),
    enableTwoRolesRule: z.boolean().optional(),
    enableAvailabilityRule: z.boolean().optional(),
    enableCapacityRule: z.boolean().optional(),
  })
  .strict();
class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}

@ApiTags('referees')
@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  private get authz() {
    return { supabase: this.supabase, orgs: this.organizations };
  }

  private userId(req: FastifyRequest): Promise<string> {
    return resolveRequestUserId(req, this.supabase);
  }

  @Get('events/:eventId/pool-assignment-settings')
  @ApiOperation({ summary: 'Get pool assignment settings (tournament override → event default)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'tournamentId', required: false, type: 'string' })
  async get(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
    @Query('tournamentId') tournamentId?: string,
  ) {
    await assertEventMember(this.authz, eventId, await this.userId(req));
    return this.settings.getSettings(eventId, tournamentId);
  }

  @Put('events/:eventId/pool-assignment-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update pool assignment settings (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'tournamentId', required: false, type: 'string' })
  async update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('tournamentId') tournamentId: string | undefined,
    @Body() dto: UpdateSettingsDto,
    @Req() req: FastifyRequest,
  ) {
    // The summary said "organizer+" and nothing enforced it until 2026-08-15.
    await assertCanManageEvent(this.authz, eventId, await this.userId(req));
    return this.settings.upsertSettings(eventId, tournamentId ?? null, dto);
  }
}
