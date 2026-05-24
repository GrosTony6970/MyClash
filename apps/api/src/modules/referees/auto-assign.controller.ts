/**
 * auto-assign.controller.ts — T-905
 *
 * POST /events/:eventId/auto-assign-referees?dryRun=true|false
 * POST /events/:eventId/lock-referee-assignments
 */

import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AssignmentBoardService } from './assignment-board.service';

@ApiTags('referees')
@Controller()
export class AutoAssignController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly assignmentBoard: AssignmentBoardService,
    private readonly notifications: NotificationSchedulerService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  // ── Auto-assign ───────────────────────────────────────────────────────────────

  @Post('events/:eventId/auto-assign-referees')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Auto-assign referees to pools (dry-run or persist)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async autoAssign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('dryRun') dryRunParam?: string,
  ): Promise<{ dryRun: boolean } & Record<string, unknown>> {
    const dryRun = dryRunParam !== 'false';
    if (dryRun) return { dryRun: true, ...(await this.assignmentBoard.preview(eventId)) };
    return { dryRun: false, ...(await this.assignmentBoard.applyPreview(eventId)) };
  }

  // ── Lock assignments ──────────────────────────────────────────────────────────

  @Post('events/:eventId/lock-referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock referee assignments (transition to confirmed)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async lockAssignments(@Param('eventId', ParseUUIDPipe) eventId: string) {
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .update({ status: 'confirmed' })
      .eq('event_id', eventId)
      .eq('status', 'assigned')
      .select('id');

    const assignmentIds = ((data as Array<{ id: string }> | null) ?? []).map(
      (assignment) => assignment.id,
    );

    await Promise.all(
      assignmentIds.flatMap((assignmentId) => [
        this.notifications.scheduleRefereeAssignmentStarting(assignmentId),
        this.notificationEvents.assignmentChanged(assignmentId),
      ]),
    );

    return { confirmed: assignmentIds.length, notificationsScheduled: assignmentIds.length };
  }
}
