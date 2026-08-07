/**
 * data-quality-deterministic.worker.ts
 *
 * Daily cron that runs the non-AI Data Quality scan. Same finder
 * battery the super-admin "Run deterministic scan" button hits — five
 * finders (global-person dupes, club dupes, unlinked referees,
 * identity gaps, placeholder names) — persisted with confidence = 1.0
 * and a synthesized summary.
 *
 * Pattern mirrors `hema-ratings-sync.worker.ts`. Scheduled at 04:00
 * UTC, 30 minutes after the HEMA sync so they don't compete on the
 * shared Redis connection.
 *
 * Queue name: "data-quality-deterministic"
 * Job name:   "scan"
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AIDataQualityService } from '../modules/admin/ai-data-quality.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const DATA_QUALITY_DETERMINISTIC_QUEUE = 'data-quality-deterministic';
export const DATA_QUALITY_DETERMINISTIC_JOB = 'scan';

// The cron has no human actor. `ai_data_quality_scans.actor_user_id` is a
// nullable UUID FK to auth.users, so "no user" is NULL — not a sentinel
// string. (A previous 'system:cron' sentinel made every insert throw
// "invalid input syntax for type uuid".)
const CRON_ACTOR_ID = null;

@Processor(DATA_QUALITY_DETERMINISTIC_QUEUE)
@Injectable()
export class DataQualityDeterministicWorker
  extends SentryReportingWorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(DataQualityDeterministicWorker.name);

  constructor(
    @InjectQueue(DATA_QUALITY_DETERMINISTIC_QUEUE) private readonly queue: Queue,
    private readonly dataQuality: AIDataQualityService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Job schedulers are upserted by scheduler id — safe to call on every API
    // container boot. (BullMQ 6 dropped `repeat` from JobsOptions; this is the
    // replacement for what was `queue.add(..., { repeat, jobId })`.)
    await this.queue.upsertJobScheduler(
      'data-quality-deterministic-daily',
      { pattern: '0 4 * * *' }, // 04:00 UTC every day
      { name: DATA_QUALITY_DETERMINISTIC_JOB, data: {} },
    );
    this.logger.log('Data quality deterministic scan scheduled (04:00 UTC)');
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Starting deterministic data quality scan (job ${job.id})`);
    try {
      const result = await this.dataQuality.runDeterministicScan(CRON_ACTOR_ID);
      this.logger.log(
        `Scan ${result.scanId} complete — ${result.candidateCount} candidates, ${result.findingCount} findings.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Deterministic scan failed (job ${job.id}): ${message}`);
      throw error;
    }
  }
}
