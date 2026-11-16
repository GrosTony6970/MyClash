/**
 * The BullMQ queues the runtime-health card watches (ruling 830): one per `@Processor` the
 * worker runs. The API reads them; the admin card labels them. A parity test in apps/api holds
 * this list equal to the processors `scripts/check-api-boot.mjs` finds.
 */
export const RUNTIME_HEALTH_QUEUE_NAMES = [
  'hema-ratings-sync',
  'notification-scheduler',
  'event-status-ticker',
  'event-archive',
  'data-quality-deterministic',
  'data-retention',
  'tls-cert-monitor',
  'runtime-health-monitor',
  'photo-cleanup',
  'spar-request-expiry',
] as const;

export type RuntimeHealthQueueName = (typeof RUNTIME_HEALTH_QUEUE_NAMES)[number];

/**
 * Why a queue row is not healthy on its own: nobody works it (read at 0 twice, ruling 840), or its
 * consumers could not be read (a Redis with no CLIENT command, a refused or failed read, a
 * timeout).
 */
export type QueueConsumerReason = 'no_consumer' | 'consumers_unreadable';

/**
 * The `error` of a Redis or queue tile when Redis did not answer within its bound (ruling 842): a
 * code the API sends and the card translates.
 */
export const RUNTIME_HEALTH_TIMEOUT = 'timeout';

/** One queue on the runtime-health card: its job counts and who works it. One owner of the shape. */
export interface RuntimeHealthQueueRow {
  name: string;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  /** Consumers working the queue; null when they could not be read. */
  consumers: number | null;
  reason: QueueConsumerReason | null;
}
