/**
 * auto-assign.controller.ts — T-905
 *
 * POST /events/:eventId/lock-referee-assignments
 * POST /events/:eventId/unlock-referee-assignments
 *
 * (The former `auto-assign-referees` shim was retired — it duplicated
 * `referee-assignment-board/preview` + `referee-assignment-preview/apply`,
 * which are what the referees page actually calls.)
 */

import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { assertCanManageEvent } from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';

@ApiTags('referees')
@Controller()
export class AutoAssignController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
    private readonly followNotifications: FollowNotificationSchedulerService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * Both routes flip every assignment's status for a whole event and fan out
   * notifications. Unauthorized until 2026-08-15.
   */
  private async assertWriter(eventId: string, req: FastifyRequest): Promise<void> {
    const userId = await resolveRequestUserId(req, this.supabase);
    await assertCanManageEvent(
      { supabase: this.supabase, orgs: this.organizations },
      eventId,
      userId,
    );
  }

  // ── Lock assignments ──────────────────────────────────────────────────────────

  @Post('events/:eventId/lock-referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock referee assignments (transition to confirmed)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async lockAssignments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertWriter(eventId, req);
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
        this.followNotifications.scheduleRefereeStarting(assignmentId),
        this.notificationEvents.assignmentChanged(assignmentId),
      ]),
    );

    return { confirmed: assignmentIds.length, notificationsScheduled: assignmentIds.length };
  }

  // ── Unlock assignments ────────────────────────────────────────────────────────

  /**
   * Slice 7a of the referees overhaul: reverse the lock-status transition
   * so an operator can re-open a confirmed board without manual SQL.
   * Mirrors `lockAssignments` above — same scope, same row filter, opposite
   * status flip. Notifications stay attached to the assignment row, so a
   * subsequent re-lock re-uses the existing notification record.
   */
  @Post('events/:eventId/unlock-referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock referee assignments (transition back to assigned)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async unlockAssignments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertWriter(eventId, req);
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .update({ status: 'assigned' })
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .select('id');

    const assignmentIds = ((data as Array<{ id: string }> | null) ?? []).map((a) => a.id);
    return { reopened: assignmentIds.length };
  }
}
