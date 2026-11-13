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
 * Job: "sweep", hourly at :35. One conditional update, then three deletes of floor-tool rows
 * (free to spar now, QR codes, open calls): safe to repeat, and to run twice at once.
 * A failed run fails its job, so Sentry hears of it; the queue is on the runtime-health card.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const SPAR_REQUEST_EXPIRY_QUEUE = 'spar-request-expiry';
export const SPAR_REQUEST_EXPIRY_SWEEP = 'sweep';
/** An open call lives this long past its close, then goes (Decision 17). */
const OPEN_CALL_KEEP_MS = 24 * 3_600_000;

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

  /**
   * End every request still waiting past its end; answers how many. Then clear the floor tools'
   * rows (free to spar now, QR codes, open calls). The four steps are independent: one that fails
   * is logged and the others still run, then the first failure fails the job so Sentry hears of
   * it. Public for tests.
   */
  async sweep(now = new Date()): Promise<number> {
    const failures: Error[] = [];
    let ended = 0;
    const steps: [string, () => Promise<unknown>][] = [
      ['spar request expiry', async () => (ended = await this.endUnanswered(now))],
      ['free-now sweep', () => this.deleteWhere('fightbook_free_now', 'until', now)],
      ['QR code sweep', () => this.deleteWhere('fightbook_qr_codes', 'expires_at', now)],
      // A call is kept a day past its close; its answers go by cascade, a spar a pick made stays.
      [
        'open call sweep',
        () =>
          this.deleteWhere(
            'spar_open_calls',
            'closes_at',
            new Date(now.getTime() - OPEN_CALL_KEEP_MS),
          ),
      ],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (e) {
        const failure = e instanceof Error ? e : new Error(String(e));
        this.logger.error(`${name} failed: ${failure.message}`);
        failures.push(failure);
      }
    }
    if (failures[0]) throw failures[0];
    return ended;
  }

  private async deleteWhere(table: string, column: string, before: Date): Promise<void> {
    const { error } = await this.supabase.service
      .from(table)
      .delete()
      .lt(column, before.toISOString());
    if (error) throw new Error(`${table} sweep failed: ${error.message}`);
  }

  private async endUnanswered(now: Date): Promise<number> {
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
