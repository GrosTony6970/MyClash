/**
 * A pad during read-only mode says maintenance, not "offline" (ruling 335).
 *
 * Read-only mode refuses every save with a 503 that carries the code
 * `read_only_mode`. The pad read any 503 as a dead network: the bar said
 * "sync error", then "offline", and a press like Start said "No connection",
 * while the wifi was fine. Nothing changes for the hit: it stays in the queue,
 * in order, and goes when the switch is off.
 */

import type { ApiFailure } from '@myclash/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import { refusalMessage } from '../lib/refusal-copy';
import {
  needsOperator,
  offersRetry,
  syncBarLabel,
  syncBarTone,
  syncPhaseOf,
} from '../lib/sync-bar';

const API_URL = 'http://localhost:4000';
const READ_ONLY = { code: 'read_only_mode', detail: 'MyClash is in maintenance.' };
const t = (key: string) => key;

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the sequence it carried; a GET lists no row. */
function mockApi(post: (sequence: number) => { status: number; body: unknown }) {
  const posted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      const r = post(sequence);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    }),
  );
  return { posted };
}

function addHit(sequence: number, clientUuid: string) {
  return enqueue({
    clientUuid,
    matchId: 'm1',
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

async function drainWatched(engine: SyncEngine): Promise<SyncState | undefined> {
  const states: SyncState[] = [];
  const stop = engine.subscribe((state) => states.push(state));
  await engine.drain();
  stop();
  return states.at(-1);
}

describe('drain — read-only mode is on (a 503 coded read_only_mode)', () => {
  it('keeps the one hit waiting and says maintenance', async () => {
    await addHit(1, 'uuid-1');
    mockApi(() => ({ status: 503, body: READ_ONLY }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last).toMatchObject({ status: 'maintenance', pendingCount: 1, rejectedCount: 0 });
    expect(await db.rejected.count(), 'a waiting hit is not a refused one').toBe(0);
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([0]);
  });

  it('stops at the first hit: the switch refuses the hits behind it too', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    const { posted } = mockApi(() => ({ status: 503, body: READ_ONLY }));

    await new SyncEngine(API_URL).drain();

    expect(posted).toEqual([1]);
  });

  it('sends the same queue, in order, once the switch is off', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    let on = true;
    const { posted } = mockApi((sequence) =>
      on ? { status: 503, body: READ_ONLY } : { status: 201, body: { id: `server-${sequence}` } },
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    on = false;

    const last = await drainWatched(engine);

    expect(posted).toEqual([1, 1, 2]);
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('counts a 503 with another code as a failed attempt, as before', async () => {
    await addHit(1, 'uuid-1');
    mockApi(() => ({ status: 503, body: { code: 'INTERNAL_SERVER_ERROR' } }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last?.status).toBe('error');
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([1]);
  });
});

describe('the bar during maintenance', () => {
  const phase = syncPhaseOf('online', 'maintenance');

  it('says maintenance and that the hits are kept', () => {
    expect(phase).toBe('maintenance');
    expect(syncBarLabel(phase, 0, t, 2)).toBe('● scoring.lice.maintenanceQueued');
  });

  it('is calm like offline, not red: the operator did nothing wrong', () => {
    expect(needsOperator(phase)).toBe(false);
    expect(syncBarTone(phase)).toBe(syncBarTone('offline'));
  });

  it('offers Retry while a hit waits, and only then', () => {
    expect(offersRetry(phase, { rejected: 0, sendable: 0, pending: 1 })).toBe(true);
    expect(offersRetry(phase, { rejected: 0, sendable: 0, pending: 0 })).toBe(false);
  });

  it('gives way to a tablet that is really offline', () => {
    expect(syncPhaseOf('offline', 'maintenance')).toBe('offline');
  });
});

describe('a press sent at once during maintenance', () => {
  const answered503 = (code: string | null): ApiFailure => ({
    kind: 'http',
    status: 503,
    detail: 'words of the API',
    code,
    details: null,
    validationErrors: null,
  });

  it('says maintenance for the read-only code', () => {
    expect(refusalMessage(answered503('read_only_mode'), t, 'fallback')).toBe(
      'scoring.corrections.maintenanceRefusal',
    );
  });

  it('still says "no connection" for any other 503', () => {
    expect(refusalMessage(answered503(null), t, 'fallback')).toBe(
      'scoring.corrections.offlineRefusal',
    );
  });
});
