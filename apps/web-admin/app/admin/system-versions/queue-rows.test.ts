import { describe, expect, it } from 'vitest';
import type { RuntimeHealthQueueRow } from '@myclash/types';
import { metricErrorText, queueRows, queueTileRows } from './queue-rows';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const K = 'admin.systemVersions.runtimeHealth';

function row(over: Partial<RuntimeHealthQueueRow>): RuntimeHealthQueueRow {
  return {
    name: 'event-archive',
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 0,
    consumers: 1,
    reason: null,
    ...over,
  };
}

describe('queueRows (ruling 830)', () => {
  it('names a known queue by its label and counts its consumers', () => {
    expect(queueRows(t, [row({ consumers: 2 })])).toEqual([
      [
        `${K}.queues.labels.eventArchive`,
        `${K}.queues.consumers {"count":2}`,
        undefined,
        'event-archive',
      ],
    ]);
  });

  it('a queue nobody works is a critical row', () => {
    expect(queueRows(t, [row({ consumers: 0, reason: 'no_consumer' })])).toEqual([
      [`${K}.queues.labels.eventArchive`, `${K}.queues.noConsumer`, 'critical', 'event-archive'],
    ]);
  });

  it('consumers that could not be read are a warning row', () => {
    expect(queueRows(t, [row({ consumers: null, reason: 'consumers_unreadable' })])).toEqual([
      [
        `${K}.queues.labels.eventArchive`,
        `${K}.queues.consumersUnreadable`,
        'warning',
        'event-archive',
      ],
    ]);
  });

  it('keys each row by its queue name, so two equal labels never share a React key', () => {
    const rows = queueRows(t, [row({ name: 'a' }), row({ name: 'b' })]);
    expect(rows.map((r) => r[3])).toEqual(['a', 'b']);
  });

  it('a queue the page does not know shows its bare name, never a raw [key]', () => {
    const rows = queueRows(t, [row({ name: 'a-newer-queue' }), row({ name: 'constructor' })]);
    expect(rows.map(([label]) => label)).toEqual(['a-newer-queue', 'constructor']);
  });
});

describe('queueTileRows', () => {
  it('shows the totals, then one row per queue', () => {
    const rows = queueTileRows(t, { totalWaiting: 3, totalFailed: 1, queues: [row({})] });
    expect(rows.map(([label]) => label)).toEqual([
      `${K}.queues.waiting`,
      `${K}.queues.failed`,
      `${K}.queues.labels.eventArchive`,
    ]);
    expect(rows.slice(0, 2).map(([, value]) => value)).toEqual(['3', '1']);
  });
});

describe('metricErrorText (ruling 842)', () => {
  it('says the timeout code in the reader’s words', () => {
    expect(metricErrorText(t, 'timeout')).toBe(`${K}.timeout`);
  });

  it('shows any other error as it came, and a dash for none', () => {
    expect(metricErrorText(t, 'connect ECONNREFUSED')).toBe('connect ECONNREFUSED');
    expect(metricErrorText(t, undefined)).toBe('—');
  });
});
