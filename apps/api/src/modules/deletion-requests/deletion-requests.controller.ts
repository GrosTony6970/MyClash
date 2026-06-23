/**
 * deletion-requests.controller.ts — Event Lifecycle Protection
 *
 * Routes:
 *   POST   /api/v1/deletion-requests
 *   PATCH  /api/v1/deletion-requests/:id/cancel
 *   GET    /api/v1/organizations/:orgId/deletion-requests?status=
 *   GET    /api/v1/deletion-requests/active?targetType=&targetId=
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { DeletionRequestsService } from './deletion-requests.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const createDeletionRequestSchema = z
  .object({
    targetType: z.enum(['event', 'tournament']),
    targetId: z.uuid(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export class CreateDeletionRequestDto extends createZodDto(createDeletionRequestSchema) {}

// ── Auth helper ───────────────────────────────────────────────────────────────

/** Resolve the authenticated user UUID from the Supabase access token. */
async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Invalid or expired session');
  return user.id;
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('deletion-requests')
@Controller()
export class DeletionRequestsController {
  constructor(
    private readonly deletionRequests: DeletionRequestsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('deletion-requests')
  @HttpCode(HttpStatus.CREATED)
  @AllowOnArchivedEvent()
  @ApiOperation({ summary: 'Submit a deletion request for an event or tournament (admin+)' })
  async create(@Body() dto: CreateDeletionRequestDto, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.deletionRequests.create(dto, userId);
  }

  @Patch('deletion-requests/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowOnArchivedEvent()
  @ApiOperation({ summary: 'Cancel a pending deletion request (admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.deletionRequests.cancel(id, userId);
  }

  @Get('organizations/:orgId/deletion-requests')
  @ApiOperation({ summary: 'List deletion requests for an organization (read_only+)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, type: 'string' })
  async listForOrganization(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status') status: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.deletionRequests.listForOrganization(orgId, status ?? null, userId);
  }

  @Get('deletion-requests/active')
  @ApiOperation({ summary: 'Get the active pending deletion request for a target (read_only+)' })
  @ApiQuery({ name: 'targetType', required: true, enum: ['event', 'tournament'] })
  @ApiQuery({ name: 'targetId', required: true, type: 'string', format: 'uuid' })
  async getActive(
    @Query('targetType') targetType: 'event' | 'tournament',
    @Query('targetId') targetId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.deletionRequests.getActivePendingForTarget(targetType, targetId, userId);
  }
}
