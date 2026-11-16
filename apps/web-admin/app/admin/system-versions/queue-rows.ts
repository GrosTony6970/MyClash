import type { KnownTranslationKey } from '@myclash/i18n';
import {
  RUNTIME_HEALTH_TIMEOUT,
  type RuntimeHealthQueueName,
  type RuntimeHealthQueueRow,
} from '@myclash/types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * A tile's row: a label, a value, a tone when the row itself is not healthy, and a stable key
 * when the label alone may not be unique (a queue row is keyed by its queue name).
 */
export type TileRow = readonly [
  label: string,
  value: string,
  tone?: 'warning' | 'critical',
  key?: string,
];

/**
 * A plain label per queue (ruling 830). The record is keyed by the queue-name union, so a queue
 * added to `RUNTIME_HEALTH_QUEUE_NAMES` does not compile here without its label, and each key is a
 * known translation key (the en/fr parity test covers French).
 */
const LABELS: Record<RuntimeHealthQueueName, KnownTranslationKey> = {
  'hema-ratings-sync': 'admin.systemVersions.runtimeHealth.queues.labels.hemaRatingsSync',
  'notification-scheduler':
    'admin.systemVersions.runtimeHealth.queues.labels.notificationScheduler',
  'event-status-ticker': 'admin.systemVersions.runtimeHealth.queues.labels.eventStatusTicker',
  'event-archive': 'admin.systemVersions.runtimeHealth.queues.labels.eventArchive',
  'data-quality-deterministic': 'admin.systemVersions.runtimeHealth.queues.labels.dataQuality',
  'data-retention': 'admin.systemVersions.runtimeHealth.queues.labels.dataRetention',
  'tls-cert-monitor': 'admin.systemVersions.runtimeHealth.queues.labels.tlsCertMonitor',
  'runtime-health-monitor': 'admin.systemVersions.runtimeHealth.queues.labels.runtimeHealthMonitor',
  'photo-cleanup': 'admin.systemVersions.runtimeHealth.queues.labels.photoCleanup',
  'spar-request-expiry': 'admin.systemVersions.runtimeHealth.queues.labels.sparRequestExpiry',
};

/**
 * A queue's label. A name the card does not know (an API newer than the page) shows as it is:
 * `t()` answers a missing key with a truthy `[key]`, so the check is on the map, not on `t`.
 */
function queueLabel(t: Translate, name: string): string {
  return Object.hasOwn(LABELS, name) ? t(LABELS[name as RuntimeHealthQueueName]) : name;
}

/** One row per queue, keyed by its name: who works it, red when nobody does (ruling 830). */
export function queueRows(t: Translate, queues: readonly RuntimeHealthQueueRow[]): TileRow[] {
  return queues.map((q): TileRow => {
    const label = queueLabel(t, q.name);
    if (q.reason === 'no_consumer') {
      const value = t('admin.systemVersions.runtimeHealth.queues.noConsumer');
      return [label, value, 'critical', q.name];
    }
    if (q.reason === 'consumers_unreadable' || q.consumers === null) {
      const value = t('admin.systemVersions.runtimeHealth.queues.consumersUnreadable');
      return [label, value, 'warning', q.name];
    }
    const count = q.consumers;
    const value = t('admin.systemVersions.runtimeHealth.queues.consumers', { count });
    return [label, value, undefined, q.name];
  });
}

/** The queue tile's rows when it answered: the totals, then one row per queue. */
export function queueTileRows(
  t: Translate,
  m: { totalWaiting?: number; totalFailed?: number; queues?: readonly RuntimeHealthQueueRow[] },
): TileRow[] {
  return [
    [t('admin.systemVersions.runtimeHealth.queues.waiting'), String(m.totalWaiting ?? 0)],
    [t('admin.systemVersions.runtimeHealth.queues.failed'), String(m.totalFailed ?? 0)],
    ...queueRows(t, m.queues ?? []),
  ];
}

/**
 * The error of an unavailable Redis or queue tile. The API sends RUNTIME_HEALTH_TIMEOUT when Redis
 * did not answer within its bound (ruling 842): the reader sees it in their language. Any other
 * error is a raw diagnostic, shown as it came.
 */
export function metricErrorText(t: Translate, error: string | undefined): string {
  return error === RUNTIME_HEALTH_TIMEOUT
    ? t('admin.systemVersions.runtimeHealth.timeout')
    : (error ?? '—');
}
