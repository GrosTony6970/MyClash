/**
 * event-archive.worker.ts
 *
 * Hourly BullMQ cron that auto-archives events whose end_date is in the past
 * and all associated tournaments have been completed for at least 24 hours.
 *
 * Eligibility criteria:
 *   - event.status IN ('running', 'completed')
 *   - event.end_date < 24h ago
 *   - ALL tournaments for the event have status = 'completed'
 *   - max(end_date, last tournament updated_at) < 24h ago
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
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';

export const EVENT_ARCHIVE_QUEUE = 'event-archive';
export const EVENT_ARCHIVE_JOB = 'archive';

@Processor(EVENT_ARCHIVE_QUEUE)
@Injectable()
export class EventArchiveWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EventArchiveWorker.name);

  constructor(
    @InjectQueue(EVENT_ARCHIVE_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      EVENT_ARCHIVE_JOB,
      {},
      {
        repeat: { pattern: '30 * * * *' },
        jobId: 'event-archive-hourly',
      },
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
      .select('id, status, end_date')
      .in('status', ['running', 'completed'])
      .lt('end_date', twentyFourHoursAgo.toISOString());

    if (candidatesErr) {
      this.logger.error(`Failed to list candidate events: ${candidatesErr.message}`);
      return { archived: [] };
    }

    const archived: string[] = [];

    for (const event of (candidates ?? []) as Array<{ id: string; end_date: string }>) {
      const { data: tournaments } = await this.supabase.service
        .from('tournaments')
        .select('id, status, updated_at')
        .eq('event_id', event.id);

      if (!tournaments?.length) continue;

      const allCompleted = (tournaments as Array<{ status: string }>).every(
        (t) => t.status === 'completed',
      );
      if (!allCompleted) continue;

      const lastTournamentDoneMs = (tournaments as Array<{ updated_at: string }>)
        .map((t) => new Date(t.updated_at).getTime())
        .reduce((a, b) => Math.max(a, b), 0);

      const endDateMs = new Date(event.end_date).getTime();
      const lastMilestone = Math.max(endDateMs, lastTournamentDoneMs);

      if (now.getTime() - lastMilestone < 24 * 60 * 60 * 1000) continue;

      const { error: updateErr } = await this.supabase.service
        .from('events')
        .update({ status: 'archived', updated_at: now.toISOString() })
        .eq('id', event.id);

      if (updateErr) {
        this.logger.warn(`Failed to archive event ${event.id}: ${updateErr.message}`);
        continue;
      }

      await this.writeAuditLog(event.id, now.toISOString());
      archived.push(event.id);
    }

    this.logger.log(`Auto-archived ${archived.length} events`);
    return { archived };
  }

  private async writeAuditLog(eventId: string, now: string): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: null,
        action: 'event.auto_archive',
        entity_type: 'event',
        entity_id: eventId,
        payload_json: { reason: 'all_tournaments_completed_and_grace_elapsed' },
        created_at: now,
      });
    } catch {
      this.logger.warn(`Could not write audit log for event.auto_archive on event:${eventId}`);
    }
  }
}
