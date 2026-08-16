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
  await db.rejected.clear();
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

// ── Rejection (HTTP 400) ──────────────────────────────────────────────────────

/**
 * The branch that used to DELETE a referee's scored hit.
 *
 * `dropTerminal` treated every 400 as "retrying can never succeed", removed the
 * row outright and logged a console warning. The pad then reported zero pending
 * and a green bar — a success signal for a hit nobody would ever see again. And
 * of the 400s this endpoint returns, only one (a best-of round awaiting advance)
 * is actually terminal; a stale sequence, a locked match and a rejected payload
 * all clear.
 *
 * These are the only cases covering it. There were none.
 */

/** Routes by method + URL, because the 400 path issues a GET and a second POST. */
function mockExchangeApi(opts: {
  /** Rows `GET /exchanges` reports — drives the re-derived sequence. */
  serverRows?: Array<{ sequence: number }>;
  /** Decides each POST's response from the sequence it carried. */
  post: (sequence: number) => { status: number; body: unknown };
}) {
  const posted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(opts.serverRows ?? []),
        });
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      const r = opts.post(sequence);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    }),
  );
  return { posted };
}

describe('drain — a refused exchange (400)', () => {
  it('is never deleted — it is held in `rejected`, and nothing is marked synced', async () => {
    await addExchange('m1', 1, 'uuid-bad');
    // Refuses at any sequence, so the re-derived retry fails too.
    mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 400, body: { message: 'Match is locked' } }),
    });

    await new SyncEngine(API_URL).drain();

    expect(await db.outbox.count(), 'the outbox must not still be blocked by it').toBe(0);
    expect(await db.synced.count(), 'it never reached the server').toBe(0);
    const held = await db.rejected.toArray();
    expect(held).toHaveLength(1);
    expect(held[0]?.clientUuid).toBe('uuid-bad');
    // The server's own words — a 400 carries a real message (only 5xx is masked).
    expect(held[0]?.rejectedReason).toBe('Match is locked');
  });

  it('is re-sent once under a sequence derived from the server, and that succeeds', async () => {
    // The collision case: the match already used sequence 1..5 elsewhere.
    await addExchange('m1', 1, 'uuid-collides');
    const { posted } = mockExchangeApi({
      serverRows: [{ sequence: 5 }],
      post: (sequence) =>
        sequence > 5
          ? { status: 201, body: { id: 'srv-1' } }
          : { status: 400, body: { message: 'duplicate key value violates unique constraint' } },
    });

    await new SyncEngine(API_URL).drain();

    expect(posted, 'first at its own sequence, then re-derived past the server max').toEqual([
      1, 6,
    ]);
    expect(await db.rejected.count(), 'a recovered hit must NOT be left held').toBe(0);
    const synced = await db.synced.toArray();
    expect(synced).toHaveLength(1);
    // The sequence actually accepted is what gets recorded, or `nextSequence`
    // would keep handing out the one the server already rejected.
    expect(synced[0]?.sequence).toBe(6);
  });

  it('retries exactly once, never in a loop', async () => {
    await addExchange('m1', 1, 'uuid-bad');
    const { posted } = mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 400, body: { message: 'nope' } }),
    });

    await new SyncEngine(API_URL).drain();

    expect(posted).toHaveLength(2);
  });

  it('keeps draining the entries behind it', async () => {
    // The property `dropTerminal` existed for: one permanently-failing entry at
    // the head of an in-order queue must not strand everything after it.
    await addExchange('m1', 1, 'uuid-bad');
    await addExchange('m1', 2, 'uuid-good');
    mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 400, body: { message: 'nope' } }),
    });
    // Second entry succeeds; the first is refused at every sequence.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }
        const body = JSON.parse(init?.body ?? '{}') as { clientUuid: string };
        const refused = body.clientUuid === 'uuid-bad';
        return Promise.resolve({
          ok: !refused,
          status: refused ? 400 : 201,
          json: () => Promise.resolve(refused ? { message: 'nope' } : { id: 'srv-2' }),
        });
      }),
    );

    await new SyncEngine(API_URL).drain();

    expect(await db.rejected.count()).toBe(1);
    expect(await db.synced.count(), 'the entry behind it still synced').toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('reports error, not idle, while a refused hit is held', async () => {
    await addExchange('m1', 1, 'uuid-bad');
    mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 400, body: { message: 'nope' } }),
    });

    const engine = new SyncEngine(API_URL);
    const states: Array<{ status: string; pendingCount: number; rejectedCount: number }> = [];
    engine.subscribe((s) => states.push({ ...s }));
    await engine.drain();

    // An empty outbox used to mean 'idle' — a green bar over a discarded hit.
    const final = states[states.length - 1]!;
    expect({
      status: final.status,
      pending: final.pendingCount,
      rejected: final.rejectedCount,
    }).toEqual({ status: 'error', pending: 0, rejected: 1 });
  });

  it('retryRejected re-queues held entries with fresh sequences and drains them', async () => {
    await addExchange('m1', 1, 'uuid-was-locked');
    mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 400, body: { message: 'Match is locked' } }),
    });
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    expect(await db.rejected.count()).toBe(1);

    // …the operator unlocks the match and hits Retry.
    mockExchangeApi({
      serverRows: [{ sequence: 9 }],
      post: () => ({ status: 201, body: { id: 'srv-9' } }),
    });
    const requeued = await engine.retryRejected();

    expect(requeued).toBe(1);
    expect(await db.rejected.count()).toBe(0);
    expect(await db.synced.count()).toBe(1);
    expect(await engine.getRejectedCount()).toBe(0);
  });
});

// ── Penalties ride the same queue ─────────────────────────────────────────────
// A card is a scored artefact that changes the score through the ruleset, so it
// belongs in the queue a hit goes through. It used to POST straight out, and a
// card issued with no wifi was LOST.

describe('drain — penalties', () => {
  async function addPenalty(matchId: string, seq: number, uuid: string) {
    return enqueue({
      kind: 'penalty',
      clientUuid: uuid,
      matchId,
      sequence: seq,
      registrationId: 'reg-1',
      occurredAt: '2026-05-21T10:00:00.000Z',
      directCard: 'yellow',
      reason: 'Excessive force',
    });
  }

  it('posts a queued penalty to the penalties endpoint', async () => {
    await addPenalty('m1', 1, 'uuid-pen-1');
    mockFetch([{ status: 201, body: { id: 'server-pen-1' } }]);

    await new SyncEngine(API_URL).drain();

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe(`${API_URL}/api/v1/matches/m1/penalties`);
  });

  it('sends the moment the card was ISSUED, not the moment it drained', async () => {
    // The property that makes queueing a card safe at all: occurred_at is
    // client-supplied and the server stores it verbatim.
    await addPenalty('m1', 1, 'uuid-pen-2');
    mockFetch([{ status: 201, body: { id: 'server-pen-2' } }]);

    await new SyncEngine(API_URL).drain();

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const body = JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
    expect(body['occurredAt']).toBe('2026-05-21T10:00:00.000Z');
    expect(body['directCard']).toBe('yellow');
    expect(body['registrationId']).toBe('reg-1');
  });

  it('drains a v2 row with no `kind` to the exchanges endpoint', async () => {
    // A referee upgrades mid-event with a queue on disk. Those rows predate the
    // discriminator and are all exchanges; reading `kind` as required would
    // route them nowhere.
    await addExchange('m1', 1, 'uuid-legacy');
    mockFetch([{ status: 201, body: { id: 'server-1' } }]);

    await new SyncEngine(API_URL).drain();

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe(`${API_URL}/api/v1/matches/m1/exchanges`);
  });

  it('keeps one queue: a card and a hit drain in the order they were scored', async () => {
    await addExchange('m1', 1, 'uuid-hit');
    await addPenalty('m1', 2, 'uuid-card');
    mockFetch([
      { status: 201, body: { id: 's1' } },
      { status: 201, body: { id: 's2' } },
    ]);

    await new SyncEngine(API_URL).drain();

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![0]).toContain('/exchanges');
    expect(calls[1]![0]).toContain('/penalties');
    expect(await db.outbox.count()).toBe(0);
  });
});
