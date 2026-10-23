/**
 * event-status-ticker.worker.ts
 *
 * Hourly cron that auto-advances event status on the Event's OWN clock
 * (`events.timezone`; rulings 152, 154), through `eventOpenWindow`:
 *   - status = 'published', 00:00 on start_date has passed            →  'running'
 *   - status = 'published' or 'running', 06:00 after end_date passed  →  'completed'
 *
 * A published Event whose whole window has passed goes straight to
 * `completed`, in one write.
 *
 * Other states are intentionally not touched:
 *   - draft     → never auto-published (editorial decision)
 *   - completed → not the ticker's (the auto-archive takes it from there, ruling 156)
 *   - archived  → terminal
 *
 * When an event flips to `completed` we mirror the same side-effect that
 * `EventsService.updateEvent()` runs for that case — `leagues.recomputeForEvent(id)`.
 * The recompute is best-effort: a failure inside one event does not abort
 * the rest of the batch.
 *
 * PostgREST cannot compare a date with an expression of another column, so the
 * worker reads the candidates, decides per Event, and writes each move as a
 * compare-and-set on the status, dates and zone it decided on: an organiser's
 * edit landing between the read and the write turns that write into a no-op,
 * logged, and the next tick decides again on the new values. The dates compare
 * as text against DATE columns, as the old set-based filters did since 0223.
 *
 * Queue name: "event-status-ticker"
 * Job name:   "tick"
 * Cron:       hourly at :05 UTC (staggered from the :30 HEMA Ratings job)
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { addDays } from '@myclash/time';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';
import { LeaguesService } from '../modules/leagues/leagues.service';
import { eventOpenWindow, unknownZoneWarning } from '../common/event-open-window';

export const EVENT_STATUS_TICK_QUEUE = 'event-status-ticker';
export const EVENT_STATUS_TICK_JOB = 'tick';

type TickedStatus = 'running' | 'completed';

interface CandidateRow {
  id: string;
  status: 'published' | 'running';
  start_date: string;
  end_date: string;
  timezone: string;
}

interface Decision {
  target: TickedStatus | null;
  problem: 'no-window' | 'unknown-zone' | null;
}

/** Where one Event goes at `now`. Pure: the caller logs the problem. */
function decide(row: CandidateRow, now: Date): Decision {
  const window = eventOpenWindow(row);
  if (!window) return { target: null, problem: 'no-window' };
  const problem = window.unknownZone ? 'unknown-zone' : null;
  if (now >= window.closesAt) return { target: 'completed', problem };
  if (row.status === 'published' && now >= window.opensAt) return { target: 'running', problem };
  return { target: null, problem };
}

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
    // Job schedulers are upserted by scheduler id — safe to call on every boot.
    await this.queue.upsertJobScheduler(
      'event-status-tick-hourly',
      { pattern: '5 * * * *' },
      { name: EVENT_STATUS_TICK_JOB, data: {} },
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
    const now = new Date();
    const moved: Record<TickedStatus, string[]> = { running: [], completed: [] };

    for (const row of await this.readCandidates(now)) {
      const { target, problem } = decide(row, now);
      if (problem === 'no-window') {
        this.logger.warn(`Event ${row.id}: its dates cannot be read; status left as ${row.status}`);
      } else if (problem === 'unknown-zone') {
        this.logger.warn(unknownZoneWarning(row.id, row.timezone));
      }
      if (target && (await this.writeOne(row, target, now.toISOString()))) {
        moved[target].push(row.id);
      }
    }

    await this.recomputeLeagues(moved.completed);

    const toRunning = moved.running.length;
    const toCompleted = moved.completed.length;
    if (toRunning + toCompleted > 0) {
      this.logger.log(`tick: →running=${toRunning}, →completed=${toCompleted}`);
    }
    return { toRunning, toCompleted };
  }

  /**
   * Published and running Events that could move now. No zone is ahead of
   * UTC+14, so no Event opens before the UTC day before its start_date, and
   * end_date >= start_date (0223): the bound cuts only Events that cannot open
   * yet, and keeps the read under PostgREST's row cap.
   */
  private async readCandidates(now: Date): Promise<CandidateRow[]> {
    const tomorrow = addDays(now.toISOString().slice(0, 10), 1);
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, status, start_date, end_date, timezone')
      .in('status', ['published', 'running'])
      .lte('start_date', tomorrow);
    if (error) {
      this.logger.warn(`Event status read failed: ${error.message}`);
      return [];
    }
    return (data ?? []) as CandidateRow[];
  }

  /**
   * Mirror the side-effect from `EventsService.updateEvent()` when status
   * becomes `completed`: recompute every league this event contributes to.
   */
  private async recomputeLeagues(completedIds: string[]): Promise<void> {
    if (!this.leagues) return;
    for (const id of completedIds) {
      try {
        await this.leagues.recomputeForEvent(id);
      } catch (err) {
        this.logger.warn(
          `League recompute failed for completed event ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** One move, only if the Event still holds what it was decided on. True when it landed. */
  private async writeOne(
    row: CandidateRow,
    target: TickedStatus,
    nowIso: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('events')
      .update({ status: target, updated_at: nowIso })
      .eq('id', row.id)
      .eq('status', row.status)
      .eq('start_date', row.start_date)
      .eq('end_date', row.end_date)
      .eq('timezone', row.timezone)
      .select('id');
    if (error) {
      this.logger.warn(`Event ${row.id}: ${row.status} → ${target} failed: ${error.message}`);
      return false;
    }
    if (!data?.length) {
      // A warn, not a log: were every write to miss, this would be the only trace.
      this.logger.warn(`Event ${row.id}: changed since the read; left for the next tick`);
      return false;
    }
    return true;
  }
}
