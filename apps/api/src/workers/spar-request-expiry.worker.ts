/**
 * spar-request-expiry.worker.ts — FightBook (slice 1)
 *
 * Ends the spar requests nobody answered before the end of their day (06:00 the next morning on
 * an Event's clock, midnight on a free date's: `spar_requests.expires_at`, spar-ask-rules.ts).
 * Every read already shows such a request as "Not this time" (`effectiveSparStatus`); this makes
 * the stored row say so too, so a fighter's own data download cannot tell an ignored request from
 * a declined one for more than an hour. No notice: a "no" never buzzes (ruling 663).
 *
 * Queue name: "spar-request-expiry"
 * Job: "sweep", hourly at :35. One conditional update: safe to repeat, and to run twice at once.
 * A failed run fails its job, so Sentry hears of it; the queue is on the runtime-health card.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const SPAR_REQUEST_EXPIRY_QUEUE = 'spar-request-expiry';
export const SPAR_REQUEST_EXPIRY_SWEEP = 'sweep';

@Processor(SPAR_REQUEST_EXPIRY_QUEUE)
@Injectable()
export class SparRequestExpiryWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SparRequestExpiryWorker.name);

  constructor(
    @InjectQueue(SPAR_REQUEST_EXPIRY_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Upserted by scheduler id: safe on every boot of either container.
    await this.queue.upsertJobScheduler(
      'spar-request-expiry-hourly',
      { pattern: '35 * * * *' },
      { name: SPAR_REQUEST_EXPIRY_SWEEP, data: {} },
    );
    this.logger.log('Spar request expiry scheduled (hourly, :35 UTC)');
  }

  async process(_job: Job): Promise<void> {
    await this.sweep();
  }

  /** End every request still waiting past its end; answers how many. Public for tests. */
  async sweep(now = new Date()): Promise<number> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .update({ status: 'not_this_time' })
      .eq('status', 'pending')
      .lte('expires_at', now.toISOString())
      .select('id');
    if (error) throw new Error(`spar request expiry failed: ${error.message}`);
    const ended = (data ?? []).length;
    if (ended > 0) this.logger.log(`ended ${ended} unanswered spar request(s)`);
    return ended;
  }
}
