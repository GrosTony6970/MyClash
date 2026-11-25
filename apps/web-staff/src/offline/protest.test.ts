/**
 * A protest goes through the pad's queue, as a card does: written on the
 * tablet before any network call, sent behind, held in the inbox when the
 * server refuses it. A protest is an entry of the bout's sheet, not a tap: it
 * takes a number of the bout's sequence, and a 400 tries once more under a
 * fresh one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { discardQuestion, heldRowNotice, heldWhoLine } from '../lib/held-hit';
import { db } from './db';
import { enqueue, getAllPending, getRejected } from './outbox';
import { queueProtest } from './protest-queue';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { pendingRowsForMatch, protestCountFor } from './pending-events';
import { waitingBehind } from './press-queue';
import { SyncEngine } from './sync';

const API_URL = 'http://localhost:4000';
const BOUT = { label: 'LSW-P1-M3', red: 'Dupont', blue: 'Martin' };
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

const REG = '0f6c2a9e-1b8d-4c3e-9a51-6d2f7e8b9c01';
const PROTEST = {
  matchId: 'm1',
  sequence: 4,
  side: { kind: 'registration', id: REG },
  clockTimeMs: 61_000,
  round: 1,
  bout: BOUT,
  cardedColor: 'red',
} as const;

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** The server: each POST answered by `post` (its nth POST, from 1); a GET answers `lists`. */
function mockApi(
  post: (nth: number) => Response,
  lists: Record<string, Array<{ sequence: number }>> = {},
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(`${API_URL}/api/v1`, '');
      if (method === 'GET') {
        calls.push({ method, path });
        const list = Object.entries(lists).find(([end]) => path.endsWith(end))?.[1] ?? [];
        return Promise.resolve(Response.json(list));
      }
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      calls.push({ method, path, body });
      return Promise.resolve(post(calls.filter((call) => call.method === 'POST').length));
    }),
  );
  return calls;
}

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST');

describe('a protest tapped on the pad', () => {
  // The tap itself (before any network call, its order, a double tap): `lib/protest-tap.test.ts`.
  it('is one row of the queue, with its Fighter, its corner and its names', async () => {
    const calls = mockApi(() => Response.json({ error: 'offline', status: 503 }, { status: 503 }));

    await queueProtest(PROTEST);

    expect(calls).toEqual([]);
    const rows = await getAllPending();
    expect(rows).toHaveLength(1);
    const { side: _side, ...fields } = PROTEST;
    expect(rows[0]).toMatchObject({ kind: 'protest', attempts: 0, ...fields, registrationId: REG });
    expect(rows[0]).not.toHaveProperty('teamId');
    expect(rows[0]?.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('it drains once to POST /matches/:id/protests with { clientUuid, sequence, registrationId, occurredAt, sentAt, clockTimeMs }', async () => {
    const calls = mockApi(() => Response.json({ id: 'protest-1' }, { status: 201 }));
    await queueProtest(PROTEST);
    const [row] = await getAllPending();

    await new SyncEngine(API_URL).drain();

    expect(posts(calls)).toHaveLength(1);
    const [sent] = posts(calls);
    expect(sent?.path).toBe('/matches/m1/protests');
    expect(Object.keys(sent?.body ?? {}).sort()).toEqual(
      ['clientUuid', 'clockTimeMs', 'occurredAt', 'registrationId', 'sentAt', 'sequence'].sort(),
    );
    expect(sent?.body).toMatchObject({
      clientUuid: row?.clientUuid,
      sequence: 4,
      registrationId: REG,
      occurredAt: row?.occurredAt,
      clockTimeMs: 61_000,
    });
    expect(await getAllPending()).toEqual([]);
    expect(await db.synced.get(row!.clientUuid)).toMatchObject({ serverId: 'protest-1' });
  });

  it('a 400 retries once under a fresh sequence read from exchanges, penalties and protests', async () => {
    const calls = mockApi(
      (nth) =>
        nth === 1
          ? Response.json({ message: 'sequence taken' }, { status: 400 })
          : Response.json({ id: 'protest-1' }, { status: 201 }),
      {
        '/exchanges': [{ sequence: 3 }],
        '/penalties': [{ sequence: 5 }],
        '/protests': [{ sequence: 9 }],
      },
    );
    await queueProtest(PROTEST);

    await new SyncEngine(API_URL).drain();

    const reads = calls.filter((call) => call.method === 'GET').map((call) => call.path);
    expect(reads.sort()).toEqual(
      ['/matches/m1/exchanges', '/matches/m1/penalties', '/matches/m1/protests'].sort(),
    );
    expect(posts(calls).map((call) => call.body?.['sequence'])).toEqual([4, 10]);
    expect(await getRejected()).toEqual([]);
  });

  it('a 409 event_results_frozen is held and its line names the fighter', async () => {
    mockApi(() =>
      Response.json(
        { message: 'Event results are frozen', code: 'event_results_frozen' },
        { status: 409 },
      ),
    );
    await queueProtest(PROTEST);

    await new SyncEngine(API_URL).drain();

    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ kind: 'protest', rejectedCode: 'event_results_frozen' });
    expect(heldWhoLine(held[0]!, t)).toBe('scoring.quarantine.protestBy {"who":"Dupont"}');
    expect(heldWhoLine({ ...held[0]!, bout: undefined }, t)).toBe(
      'scoring.quarantine.protestBy {"who":"scoring.lice.red"}',
    );
    expect(heldRowNotice(held[0], t)).toMatch(/^scoring\.clock\.entryHeld /);
    expect(discardQuestion(held[0]!, t)).toMatchObject({
      title: 'scoring.quarantine.discardProtestTitle',
      description: 'scoring.quarantine.discardProtestBody',
    });
  });

  it('a protest behind a held card of the same bout waits, and is counted', async () => {
    const calls = mockApi(() =>
      Response.json(
        { message: 'Event results are frozen', code: 'event_results_frozen' },
        { status: 409 },
      ),
    );
    await enqueue({
      kind: 'penalty',
      clientUuid: crypto.randomUUID(),
      matchId: 'm1',
      sequence: 3,
      registrationId: REG,
      occurredAt: new Date().toISOString(),
      directCard: 'yellow',
      reason: 'Late',
      bout: BOUT,
    });
    await queueProtest(PROTEST);

    await new SyncEngine(API_URL).drain();

    expect(posts(calls).map((call) => call.path)).toEqual(['/matches/m1/penalties']);
    const held = await getRejected();
    expect(held.map((row) => row.kind)).toEqual(['penalty']);
    const waiting = await getAllPending();
    expect(waiting.map((row) => row.kind)).toEqual(['protest']);
    expect(await waitingBehind(held[0]!)).toBe(1);
    // The chip's count: the protest that waits is counted.
    const { protests: pending } = pendingRowsForMatch({
      entries: waiting,
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [],
      serverProtests: [],
    });
    expect(protestCountFor({ server: [], pending, sideId: REG })).toBe(1);
  });
});
