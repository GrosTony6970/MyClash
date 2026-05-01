/**
 * sync.test.ts — T-503 acceptance criteria
 *
 * AC:
 *   ✓ Reconnect → pending exchanges drain in order
 *   ✓ Server idempotency on client_uuid (409 treated as success)
 *   ✓ UI shows pending count, syncing indicator, error state
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue } from './outbox';
import { SyncEngine } from './sync';

const API_URL = 'http://localhost:4000';

// Reset DB between tests
beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const r = responses[call] ?? responses[responses.length - 1]!;
      call++;
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    }),
  );
}

async function addExchange(matchId: string, seq: number, uuid: string) {
  return enqueue({
    clientUuid: uuid,
    matchId,
    sequence: seq,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

// ── Drain in order ────────────────────────────────────────────────────────────

describe('drain — order', () => {
  it('processes entries in insertion order (by id)', async () => {
    await addExchange('m1', 1, 'uuid-1');
    await addExchange('m1', 2, 'uuid-2');
    await addExchange('m1', 3, 'uuid-3');

    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_, opts: RequestInit) => {
        const body = JSON.parse(opts.body as string) as { clientUuid: string };
        order.push(body.clientUuid);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ id: `srv-${body.clientUuid}` }),
        });
      }),
    );

    const engine = new SyncEngine(API_URL);
    await engine.drain();

    expect(order).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('drain — idempotency', () => {
  it('treats 409 as success (already on server)', async () => {
    await addExchange('m1', 1, 'uuid-dup');

    mockFetch([{ status: 409, body: { id: 'srv-existing' } }]);

    const engine = new SyncEngine(API_URL);
    const states: string[] = [];
    engine.subscribe((s) => states.push(s.status));

    await engine.drain();

    // Entry removed from outbox
    expect(await db.outbox.count()).toBe(0);
    // Written to synced
    const synced = await db.synced.get('uuid-dup');
    expect(synced?.serverId).toBe('srv-existing');
  });

  it('treats 201 as success', async () => {
    await addExchange('m1', 1, 'uuid-new');
    mockFetch([{ status: 201, body: { id: 'srv-new' } }]);

    const engine = new SyncEngine(API_URL);
    await engine.drain();

    expect(await db.outbox.count()).toBe(0);
    expect((await db.synced.get('uuid-new'))?.serverId).toBe('srv-new');
  });
});

// ── UI state emissions ────────────────────────────────────────────────────────

describe('drain — state emissions', () => {
  it('emits syncing then idle on success', async () => {
    await addExchange('m1', 1, 'uuid-a');
    mockFetch([{ status: 201, body: { id: 'srv-a' } }]);

    const engine = new SyncEngine(API_URL);
    const states: string[] = [];
    engine.subscribe((s) => states.push(s.status));

    await engine.drain();

    expect(states).toContain('syncing');
    expect(states[states.length - 1]).toBe('idle');
  });

  it('emits idle immediately when outbox empty', async () => {
    const engine = new SyncEngine(API_URL);
    const states: string[] = [];
    engine.subscribe((s) => states.push(s.status));

    await engine.drain();

    expect(states).toEqual(['idle']);
  });

  it('emits pendingCount correctly', async () => {
    await addExchange('m1', 1, 'uuid-b');
    await addExchange('m1', 2, 'uuid-c');

    mockFetch([
      { status: 201, body: { id: 'srv-b' } },
      { status: 201, body: { id: 'srv-c' } },
    ]);

    const engine = new SyncEngine(API_URL);
    const counts: number[] = [];
    engine.subscribe((s) => counts.push(s.pendingCount));

    await engine.drain();

    // Should decrease as entries are synced
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('emits offline after 3 consecutive network failures', async () => {
    await addExchange('m1', 1, 'uuid-fail-1');
    await addExchange('m1', 2, 'uuid-fail-2');
    await addExchange('m1', 3, 'uuid-fail-3');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const engine = new SyncEngine(API_URL);
    const states: string[] = [];
    engine.subscribe((s) => states.push(s.status));

    await engine.drain();

    expect(states).toContain('offline');
  });
});

// ── No double-drain ───────────────────────────────────────────────────────────

describe('drain — concurrency', () => {
  it('second drain call while first is running is a no-op', async () => {
    await addExchange('m1', 1, 'uuid-slow');

    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 201,
                json: () => Promise.resolve({ id: 'srv-slow' }),
              }),
            50,
          ),
        );
      }),
    );

    const engine = new SyncEngine(API_URL);
    // Fire two drains simultaneously
    const [, second] = await Promise.all([engine.drain(), engine.drain()]);

    // Only one fetch call — second drain was a no-op
    expect(callCount).toBe(1);
    void second; // suppress unused warning
  });
});
