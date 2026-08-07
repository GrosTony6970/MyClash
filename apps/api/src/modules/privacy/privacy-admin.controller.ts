/**
 * privacy-admin.controller.ts — super-admin data-protection surface.
 *
 *   GET   /api/v1/admin/data-retention          — policy + last sweep
 *   PATCH /api/v1/admin/data-retention          — edit the horizons
 *   POST  /api/v1/admin/data-retention/run      — sweep now
 *   POST  /api/v1/admin/global-persons/:id/anonymise — the erasure escape hatch
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { PlatformRole } from '../admin/guards/platform-role.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { ErasureService } from './erasure.service';
import { RetentionService } from './retention.service';
import { getActorId } from '../../common/auth/actor';

// ── DTOs ──────────────────────────────────────────────────────────────────────

/** 0 means "keep forever" on every horizon; the cap is ~27 years. */
const days = z.number().int().min(0).max(10000);

const updateRetentionSchema = z
  .object({
    enabled: z.boolean().optional(),
    guestSessionDays: days.optional(),
    aiUsageLogDays: days.optional(),
    broadcastRecipientDays: days.optional(),
    auditLogDays: days.optional(),
  })
  .strict();
export class UpdateRetentionDto extends createZodDto(updateRetentionSchema) {}

const anonymiseSchema = z
  .object({
    /** Recorded in the audit log. Anonymisation is irreversible, so it is justified. */
    reason: z.string().min(10).max(500),
    confirmation: z.literal('ANONYMISE'),
  })
  .strict();
export class AnonymiseDto extends createZodDto(anonymiseSchema) {}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin')
export class PrivacyAdminController {
  constructor(
    private readonly retention: RetentionService,
    private readonly erasure: ErasureService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('data-retention')
  @ApiOperation({ summary: 'Data retention policy and last sweep result (super admin)' })
  async getRetention() {
    return this.retention.getSettings();
  }

  @Patch('data-retention')
  @ApiOperation({ summary: 'Update data retention horizons (super admin)' })
  async updateRetention(@Body() dto: UpdateRetentionDto, @Req() req: FastifyRequest) {
    return this.retention.updateSettings(dto, getActorId(req));
  }

  @Post('data-retention/run')
  @ApiOperation({ summary: 'Run the retention sweep immediately (super admin)' })
  async runRetention() {
    return { removed: await this.retention.runSweep() };
  }

  @Post('global-persons/:id/anonymise')
  @ApiOperation({
    summary:
      'Fully anonymise a profile — replaces the name and rotates the slug (super admin, irreversible)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async anonymise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnonymiseDto,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = getActorId(req);
    const { counts, previousSlugHash } = await this.erasure.anonymiseGlobalPerson(id);
    await this.erasure.recordErasure(id, 'admin_anonymisation', counts, previousSlugHash);

    // Governance record. The reason is why this is not the default behaviour:
    // name retention is the norm and each departure from it is justified.
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'global_person.anonymise',
      entityType: 'global_person',
      entityId: id,
      payload: { reason: dto.reason, redacted: counts },
    });

    return { ok: true, redacted: counts };
  }
}
