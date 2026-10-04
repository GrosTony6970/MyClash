/**
 * An organiser's queued hit renews her login before the pad says "session ended".
 *
 * An account's login lasts an hour and its refresh cookie thirty days; only
 * `GET /api/v1/me` turns the one into the other. The drain posted with a bare
 * `fetch`, so an organiser who scored for more than an hour met a 401 and the
 * pad told her to sign in again, though one call would have renewed her login.
 * A PIN session cannot be renewed: `/me` answers `anonymous` and its 401 stands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const NO_SESSION = { message: 'Staff session required' };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
  // The renewal runs in a browser only.
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `me` is what `/api/v1/me` answers. A POST is answered 401 until `/me` has
 * answered `claimed`, unless `stillRefused` keeps the 401.
 */
function mockApi(me: 'claimed' | 'anonymous', stillRefused = false) {
  const posted: string[] = [];
  let meCalls = 0;
  let renewed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === `${API_URL}/api/v1/me`) {
        meCalls += 1;
        renewed = me === 'claimed';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ type: me }),
        });
      }
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const { sequence } = JSON.parse(init?.body ?? '{}') as { sequence: number };
      posted.push(`${url.slice(url.lastIndexOf('/') + 1)} ${sequence}`);
      const taken = renewed && !stillRefused;
      return Promise.resolve({
        ok: taken,
        status: taken ? 201 : 401,
        json: () => Promise.resolve(taken ? { id: `srv-${sequence}` } : NO_SESSION),
      });
    }),
  );
  return { posted, meCalls: () => meCalls };
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

describe('drain — a 401 on a queued hit', () => {
  it('renews an organiser’s login once and sends the whole queue', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    const api = mockApi('claimed');

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(api.posted).toEqual(['exchanges 1', 'exchanges 1', 'exchanges 2', 'exchanges 3']);
    expect(api.meCalls()).toBe(1);
    expect((await db.synced.toArray()).map((row) => row.clientUuid).sort()).toEqual([
      'uuid-1',
      'uuid-2',
      'uuid-3',
    ]);
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('renews for a card as for a hit', async () => {
    await enqueue({
      kind: 'penalty',
      clientUuid: 'uuid-card',
      matchId: 'm1',
      sequence: 1,
      registrationId: 'reg-red',
      occurredAt: new Date().toISOString(),
      directCard: 'yellow',
      reason: 'late',
    });
    const api = mockApi('claimed');

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(api.posted).toEqual(['penalties 1', 'penalties 1']);
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('a PIN session is not renewed: the hit waits and the pad says the session has ended', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    const api = mockApi('anonymous');

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(api.posted, 'the refused hit is not sent again').toEqual(['exchanges 1']);
    expect(api.meCalls()).toBe(1);
    expect(last).toMatchObject({ status: 'signed-out', pendingCount: 2, rejectedCount: 0 });
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([0, 0]);
  });

  it('a second 401 after the renewal is the answer: one more try, never a loop', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    const api = mockApi('claimed', true);

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(api.posted).toEqual(['exchanges 1', 'exchanges 1']);
    expect(api.meCalls()).toBe(1);
    expect(last).toMatchObject({ status: 'signed-out', pendingCount: 2 });
  });
});
