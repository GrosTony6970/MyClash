/**
 * data-retention.worker.ts
 *
 * Daily sweep that ages out personal telemetry past its configured horizon:
 * guest-session device data (IP + user-agent), AI call logs, broadcast recipient
 * rows, and expired claim tokens. Storage limitation, GDPR Art. 5(1)(e).
 *
 * Competition results are NOT swept and never will be — they are a public record
 * (Art. 17(3)), which is why RetentionService has no horizon for them.
 *
 * The audit log defaults to keep-forever. It is a governance record as much as
 * personal data; PII inside it is removed by redaction-on-erasure instead, so
 * this job does not delete history about people who never asked for erasure.
 *
 * Queue name: "data-retention"
 * Job name:   "sweep"
 * Cron:       daily at 05:00 UTC (staggered clear of hema-ratings-sync 03:30
 *             and data-quality 04:00)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { RetentionService } from '../modules/privacy/retention.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const DATA_RETENTION_QUEUE = 'data-retention';
export const DATA_RETENTION_JOB = 'sweep';

@Processor(DATA_RETENTION_QUEUE)
@Injectable()
export class DataRetentionWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DataRetentionWorker.name);

  constructor(
    @InjectQueue(DATA_RETENTION_QUEUE) private readonly queue: Queue,
    private readonly retention: RetentionService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // BullMQ repeatable jobs are idempotent by jobId — safe to call on every boot.
    await this.queue.add(
      DATA_RETENTION_JOB,
      {},
      {
        repeat: { pattern: '0 5 * * *' },
        jobId: 'data-retention-daily',
      },
    );
    this.logger.log('Data retention sweep scheduled (daily, 05:00 UTC)');
  }

  async process(_job: Job): Promise<void> {
    await this.sweep();
  }

  /** Public so tests and dev REPLs can drive it without the BullMQ queue. */
  async sweep(): Promise<Record<string, number>> {
    return this.retention.runSweep();
  }
}
