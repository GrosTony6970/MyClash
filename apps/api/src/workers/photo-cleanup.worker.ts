/**
 * photo-cleanup.worker.ts
 *
 * Takes Event photo images out of the photo bucket (design, "Storage and deletion"). The logic is
 * `PhotoCleanup` (modules/photos/photo-cleanup.ts); this is the schedule.
 *
 * Queue name: "photo-cleanup"
 * Jobs:
 *   "tick"    every 5 minutes: expire the photos of every Event past its deletion instant
 *             (00:00 of end_date + 31, Event clock), then drain the tombstones. Every 5 minutes,
 *             not nightly, so an image is gone within minutes of the instant on any clock.
 *   "orphans" hourly at :50: delete the bucket objects no photo row names.
 *   "drain"   queued by a moderator's delete: drain the tombstones now, without expiring, so the
 *             deleted images go at once rather than at the next tick.
 *
 * A failed run fails its job, so Sentry hears of it; the queue is on the runtime-health card.
 * Both runs are safe to repeat, and to run twice at once.
 */

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PHOTO_STORE, type PhotoStore } from '../modules/photos/photo-bucket';
import { PhotoCleanup } from '../modules/photos/photo-cleanup';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

export const PHOTO_CLEANUP_QUEUE = 'photo-cleanup';
export const PHOTO_CLEANUP_TICK = 'tick';
export const PHOTO_ORPHAN_SWEEP = 'orphans';
export const PHOTO_DRAIN = 'drain';

@Processor(PHOTO_CLEANUP_QUEUE)
@Injectable()
export class PhotoCleanupWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PhotoCleanupWorker.name);
  readonly cleanup: PhotoCleanup;

  constructor(
    @InjectQueue(PHOTO_CLEANUP_QUEUE) private readonly queue: Queue,
    supabase: SupabaseService,
    @Inject(PHOTO_STORE) store: PhotoStore | null,
  ) {
    super();
    this.cleanup = new PhotoCleanup(supabase.service, store, this.logger);
  }

  async onModuleInit(): Promise<void> {
    // Upserted by scheduler id: safe on every boot of either container.
    await this.queue.upsertJobScheduler(
      'photo-cleanup-tick',
      { pattern: '*/5 * * * *' },
      { name: PHOTO_CLEANUP_TICK, data: {} },
    );
    await this.queue.upsertJobScheduler(
      'photo-orphan-sweep',
      { pattern: '50 * * * *' },
      { name: PHOTO_ORPHAN_SWEEP, data: {} },
    );
    this.logger.log(
      'Photo clean-up scheduled (expiry + drain every 5 minutes, orphan sweep hourly)',
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name === PHOTO_CLEANUP_TICK) {
      // A failed expiry must not hold up the images already queued: drain anyway, then fail. It
      // is logged first, so a drain that fails too cannot hide it.
      const expired = await this.cleanup.expire().then(
        () => null,
        (err: unknown) => {
          this.logger.error(err instanceof Error ? err.message : String(err));
          return err;
        },
      );
      await this.cleanup.drain();
      if (expired) throw expired;
      return;
    }
    if (job.name === PHOTO_ORPHAN_SWEEP) {
      await this.cleanup.sweep();
      return;
    }
    if (job.name === PHOTO_DRAIN) {
      await this.cleanup.drain();
      return;
    }
    throw new Error(`Unknown photo clean-up job ${JSON.stringify(job.name)}`);
  }
}
