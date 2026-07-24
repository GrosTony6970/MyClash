/**
 * event-status-ticker.worker.ts
 *
 * Hourly cron that auto-advances event status based on the event's dates:
 *   - status = 'published', start_date <= today  →  status = 'running'
 *   - status = 'running',   end_date   <  today  →  status = 'completed'
 *
 * Other states are intentionally not touched:
 *   - draft     → never auto-published (editorial decision)
 *   - completed → terminal
 *   - archived  → terminal
 *
 * When an event flips to `completed` we mirror the same side-effect that
 * `EventsService.updateEvent()` runs for that case — `leagues.recomputeForEvent(id)`.
 * The recompute is best-effort: a failure inside one event does not abort
 * the rest of the batch.
 *
 * Dates are stored as plain ISO `YYYY-MM-DD` text columns and interpreted
 * as midnight UTC of that day, matching the rest of the codebase.
 *
 * Queue name: "event-status-ticker"
 * Job name:   "tick"
 * Cron:       hourly at :05 UTC (staggered from the :30 HEMA Ratings job)
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';
import { LeaguesService } from '../modules/leagues/leagues.service';

export const EVENT_STATUS_TICK_QUEUE = 'event-status-ticker';
export const EVENT_STATUS_TICK_JOB = 'tick';

@Processor(EVENT_STATUS_TICK_QUEUE)
@Injectable()
export class EventStatusTickerWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EventStatusTickerWorker.name);

  constructor(
    @InjectQueue(EVENT_STATUS_TICK_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
    @Optional() private readonly leagues?: LeaguesService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // BullMQ repeatable jobs are idempotent by jobId — safe to call on every boot.
    await this.queue.add(
      EVENT_STATUS_TICK_JOB,
      {},
      {
        repeat: { pattern: '5 * * * *' },
        jobId: 'event-status-tick-hourly',
      },
    );
    this.logger.log('Event status ticker scheduled (hourly, :05 UTC)');
  }

  async process(_job: Job): Promise<void> {
    await this.tick();
  }

  /**
   * Public so tests + dev REPLs can drive it without going through the
   * BullMQ queue. Returns the count of transitions in each direction for
   * test assertions; the production path discards the result.
   */
  async tick(): Promise<{ toRunning: number; toCompleted: number }> {
    const today = todayUtcDate();
    const nowIso = new Date().toISOString();

    // Transition 1: published → running
    const { data: started, error: startedError } = await this.supabase.service
      .from('events')
      .update({ status: 'running', updated_at: nowIso })
      .eq('status', 'published')
      .lte('start_date', today)
      .select('id');
    if (startedError) {
      this.logger.warn(`published → running failed: ${startedError.message}`);
    }
    const toRunning = (started ?? []).length;

    // Transition 2: running → completed (end_date is in the past — strictly less than today)
    const { data: finished, error: finishedError } = await this.supabase.service
      .from('events')
      .update({ status: 'completed', updated_at: nowIso })
      .eq('status', 'running')
      .lt('end_date', today)
      .select('id');
    if (finishedError) {
      this.logger.warn(`running → completed failed: ${finishedError.message}`);
    }
    const completedRows = (finished ?? []) as Array<{ id: string }>;
    const toCompleted = completedRows.length;

    // Mirror the side-effect from `EventsService.updateEvent()` when status
    // becomes `completed`: recompute every league this event contributes to.
    if (this.leagues) {
      for (const row of completedRows) {
        try {
          await this.leagues.recomputeForEvent(row.id);
        } catch (err) {
          this.logger.warn(
            `League recompute failed for completed event ${row.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    if (toRunning + toCompleted > 0) {
      this.logger.log(`tick: published→running=${toRunning}, running→completed=${toCompleted}`);
    }
    return { toRunning, toCompleted };
  }
}

function todayUtcDate(): string {
  // Match the existing convention: plain `YYYY-MM-DD` strings, UTC reference.
  return new Date().toISOString().slice(0, 10);
}
