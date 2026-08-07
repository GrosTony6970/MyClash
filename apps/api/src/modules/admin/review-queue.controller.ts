import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { ReviewQueueService } from './review-queue.service';
import { getActorId } from '../../common/auth/actor';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const approveQueueItemSchema = z
  .object({ typedConfirmation: z.string().max(50).optional() })
  .strict();
export class ApproveQueueItemDto extends createZodDto(approveQueueItemSchema) {}

const rejectQueueItemSchema = z.object({ rejectionReason: z.string().min(10).max(500) }).strict();
export class RejectQueueItemDto extends createZodDto(rejectQueueItemSchema) {}

// ── Helper ────────────────────────────────────────────────────────────────────

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('platform_admin')
@Controller('admin/review-queue')
export class ReviewQueueController {
  constructor(private readonly service: ReviewQueueService) {}

  @Get()
  @ApiOperation({ summary: 'List all pending review queue items across all types (super admin)' })
  @ApiQuery({
    name: 'type',
    required: false,
    description:
      'deletion | exchange_edit | club_review | league_tournament_request | league_membership_request',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'pending (default) | all | approved | rejected | ...',
  })
  async list(@Query('type') type?: string, @Query('status') status?: string) {
    return this.service.listAll(type ?? null, status ?? null);
  }

  @Post(':type/:id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowOnArchivedEvent()
  @ApiOperation({ summary: 'Approve a queued review item (super admin)' })
  @ApiParam({ name: 'type', type: 'string' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async approve(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: ApproveQueueItemDto,
    @Req() req: FastifyRequest,
  ) {
    await this.service.approve(type, id, getActorId(req), body);
  }

  @Post(':type/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowOnArchivedEvent()
  @ApiOperation({ summary: 'Reject a queued review item (super admin)' })
  @ApiParam({ name: 'type', type: 'string' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async reject(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: RejectQueueItemDto,
    @Req() req: FastifyRequest,
  ) {
    await this.service.reject(type, id, getActorId(req), body.rejectionReason);
  }
}
