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
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
    // The Impossible rules (ADR-016, hard rule 8) have no setting: a body naming one is refused.
    enforceRefereeNoBackToBack: z.boolean().optional(),
    refereeRestMinSlots: z.number().int().min(0).max(5).optional(),
    // ADR-019: most bouts a person referees in one Event day; 0 = no cap.
    maxBoutsPerDay: z.number().int().min(0).max(200).optional(),
    workshopConflictWarning: z.boolean().optional(),
    ratingBasedOrdering: z.boolean().optional(),
    workloadBalance: z.boolean().optional(),
    // The Discouraged rules' switches and the capacity warning's (all default true).
    enableOwnPoolRule: z.boolean().optional(),
    enableOwnPoolSpanRule: z.boolean().optional(),
    enableTwoRolesRule: z.boolean().optional(),
    enableCapacityRule: z.boolean().optional(),
  })
  .strict();
export class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}

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
  @ApiOperation({ summary: "Get the Event's pool assignment settings" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async get(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    await assertEventMember(this.authz, eventId, await this.userId(req));
    return this.settings.getSettings(eventId);
  }

  @Put('events/:eventId/pool-assignment-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update the Event's pool assignment settings (organizer+)" })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateSettingsDto,
    @Req() req: FastifyRequest,
  ) {
    // The summary said "organizer+" and nothing enforced it until 2026-08-15. One row per Event:
    // the referee rules are set in one place (ruling 142), so there is no per-Tournament door.
    await assertCanManageEvent(this.authz, eventId, await this.userId(req));
    return this.settings.upsertSettings(eventId, dto);
  }
}
