/**
 * event-archive.worker.ts
 *
 * Hourly BullMQ cron that auto-archives events whose end_date is in the past
 * and all associated tournaments have been completed for at least 24 hours.
 *
 * Eligibility criteria:
 *   - event.status = 'completed' (the ticker, with its League recompute, first; ruling 156)
 *   - event.end_date < 24h ago
 *   - ALL tournaments for the event have status = 'completed'
 *   - max(end_date, last tournament updated_at) < 24h ago
 *   - while photos are not Off, the photo upload window has closed (ruling 441)
 *
 * When an event is archived:
 *   - event.status is set to 'archived'
 *   - an audit_log row is inserted with action 'event.auto_archive'
 *
 * Queue name: "event-archive"
 * Job name:   "archive"
 * Cron:       hourly at :30 UTC
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { insertAuditLog } from '../common/audit-log';
import { photoArchiveHold } from '../modules/photos/photo-window';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const EVENT_ARCHIVE_QUEUE = 'event-archive';
export const EVENT_ARCHIVE_JOB = 'archive';

type ArchiveCandidate = Parameters<typeof photoArchiveHold>[0] & { id: string; end_date: string };

@Processor(EVENT_ARCHIVE_QUEUE)
@Injectable()
export class EventArchiveWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EventArchiveWorker.name);

  constructor(
    @InjectQueue(EVENT_ARCHIVE_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'event-archive-hourly',
      { pattern: '30 * * * *' },
      { name: EVENT_ARCHIVE_JOB, data: {} },
    );
    this.logger.log('Event archive cron scheduled (hourly, :30 UTC)');
  }

  async process(_job: Job): Promise<void> {
    await this.runAutoArchive();
  }

  /**
   * Public so tests and dev REPLs can drive it directly.
   * Returns the list of archived event IDs.
   */
  async runAutoArchive(): Promise<{ archived: string[] }> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: candidates, error: candidatesErr } = await this.supabase.service
      .from('events')
      .select('id, status, start_date, end_date, timezone, photo_mode')
      .eq('status', 'completed')
      // end_date is a DATE (0223): every Event that ended on or before the day 24 h ago, the same
      // rows the old text comparison with the full timestamp took. `dueForArchive` holds the 24 h.
      .lte('end_date', twentyFourHoursAgo.toISOString().slice(0, 10));

    if (candidatesErr) {
      this.logger.error(`Failed to list candidate events: ${candidatesErr.message}`);
      return { archived: [] };
    }

    const archived: string[] = [];

    for (const event of (candidates ?? []) as ArchiveCandidate[]) {
      if (!(await this.dueForArchive(event, now))) continue;

      // Still completed: an Event reopened since the read is left alone.
      const { data: hit, error: updateErr } = await this.supabase.service
        .from('events')
        .update({ status: 'archived', updated_at: now.toISOString() })
        .eq('id', event.id)
        .eq('status', 'completed')
        .select('id');

      if (updateErr) {
        this.logger.warn(`Failed to archive event ${event.id}: ${updateErr.message}`);
        continue;
      }
      if (!hit?.length) {
        this.logger.log(`Event ${event.id}: no longer completed; not archived`);
        continue;
      }

      await this.writeAuditLog(event.id, now.toISOString());
      archived.push(event.id);
    }

    this.logger.log(`Auto-archived ${archived.length} events`);
    return { archived };
  }

  /**
   * Every Tournament completed, 24 h past both the end date and the last of them, and, while the
   * Event's photos are not Off, its photo upload window closed (ruling 441).
   */
  private async dueForArchive(event: ArchiveCandidate, now: Date): Promise<boolean> {
    const { data: tournaments } = await this.supabase.service
      .from('tournaments')
      .select('id, status, updated_at')
      .eq('event_id', event.id);

    if (!tournaments?.length) return false;

    const allCompleted = (tournaments as Array<{ status: string }>).every(
      (t) => t.status === 'completed',
    );
    if (!allCompleted) return false;

    const lastTournamentDoneMs = (tournaments as Array<{ updated_at: string }>)
      .map((t) => new Date(t.updated_at).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    const endDateMs = new Date(event.end_date).getTime();
    const lastMilestone = Math.max(endDateMs, lastTournamentDoneMs);

    if (now.getTime() - lastMilestone < 24 * 60 * 60 * 1000) return false;

    const hold = photoArchiveHold(event, now);
    if (hold) {
      this.logger.log(
        `Event ${event.id}: photo uploads open until ${hold.toISOString()}; not archived`,
      );
      return false;
    }
    return true;
  }

  private async writeAuditLog(eventId: string, now: string): Promise<void> {
    try {
      await insertAuditLog(this.supabase.service, {
        actorUserId: null,
        action: 'event.auto_archive',
        entityType: 'event',
        entityId: eventId,
        payload: { reason: 'all_tournaments_completed_and_grace_elapsed' },
        // The batch's instant, not the insert's: every event archived in one run
        // shares a timestamp so the run can be grouped by it.
        createdAt: now,
      });
    } catch {
      this.logger.warn(`Could not write audit log for event.auto_archive on event:${eventId}`);
    }
  }
}
