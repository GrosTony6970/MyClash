import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PHOTO_DRAIN } from '../../workers/photo-cleanup.worker';

/**
 * After a photo row is deleted: its images were queued by the row trigger (0250); ask for the
 * drain now, NOT awaited. With Redis down a queue add waits in the client's offline queue for
 * minutes, and the 5-minute tick drains the tombstone anyway. The one owner, for the moderator's
 * delete and her own.
 */
export function requestDrain(queue: Queue, logger: Pick<Logger, 'warn'>, photoId: string): void {
  void queue
    .add(PHOTO_DRAIN, {}, { removeOnComplete: true, removeOnFail: { age: 86_400, count: 100 } })
    .catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Photo ${photoId} deleted; its drain was not queued: ${reason}`);
    });
}
