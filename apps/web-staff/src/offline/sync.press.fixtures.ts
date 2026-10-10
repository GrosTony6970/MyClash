/**
 * A table with no wifi: the official starts the clock, scores, and ends the
 * bout. The tablet's queue holds the clock presses with the hits, in the order
 * of the bout. These helpers put such a queue in the store and stand in for
 * the server.
 */
import { vi } from 'vitest';
import type { ClockPress } from '@myclash/types';
import { db, type OutboxEntry } from './db';
import { enqueue } from './outbox';
import { queuePress } from './press-queue';

export const API_URL = 'http://localhost:4000';
export const BOUT = { label: 'P1', red: 'Ana Red', blue: 'Bo Blue' };

/** The tablet's clocks at 10:00, on one page. */
export const AT_TEN = { wall: Date.parse('2026-10-10T10:00:00.000Z'), page: 60_000, origin: 1 };

export async function clearStore(): Promise<void> {
  await Promise.all([db.outbox.clear(), db.synced.clear(), db.rejected.clear()]);
  vi.restoreAllMocks();
}

/** A press of bout `matchId`, made `secondsAfterTen` seconds after 10:00. */
export function addPress(
  action: ClockPress,
  matchId = 'm1',
  secondsAfterTen = 0,
): Promise<OutboxEntry> {
  const ms = secondsAfterTen * 1000;
  return queuePress(
    { matchId, action, bout: BOUT },
    { wall: AT_TEN.wall + ms, page: AT_TEN.page + ms, origin: AT_TEN.origin },
  );
}

export function addHit(matchId = 'm1', clientUuid = crypto.randomUUID()): Promise<number> {
  return enqueue({
    clientUuid,
    matchId,
    sequence: 1,
    type: 'clean',
    occurredAt: new Date(AT_TEN.wall).toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 2,
    bout: BOUT,
  });
}

/** One call the tablet made: its door, the bout, and for a press its button. */
export type Call = `${'clock' | 'exchanges'} ${string}${string}`;

export interface Answer {
  status: number;
  body?: unknown;
}

/**
 * The server. `answer` says how each write is answered, from the call as
 * `clock m1 start` or `exchanges m1`; with none, every write is taken. A GET
 * lists no row (the read before a second try of a hit).
 */
export function mockServer(
  answer: (call: string, nth: number) => Answer | undefined = () => undefined,
) {
  const calls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const [, matchId, door] = /matches\/([^/]+)\/(\w+)$/.exec(url) ?? [];
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      const call =
        door === 'clock' ? `clock ${matchId} ${String(body['action'])}` : `${door} ${matchId}`;
      calls.push(call);
      bodies.push(body);
      const said = answer(call, calls.length) ?? {
        status: door === 'clock' ? 200 : 201,
        body: door === 'clock' ? { status: 'running', matchId } : { id: `saved-${calls.length}` },
      };
      return Promise.resolve({
        ok: said.status >= 200 && said.status < 300,
        status: said.status,
        json: () => Promise.resolve(said.body ?? {}),
      });
    }),
  );
  return { calls, bodies };
}

export const refused = (status: number, code: string): Answer => ({
  status,
  body: { message: `the API's words for ${code}`, code },
});

/** The dead network, as the pad's service worker answers it. */
export const OFFLINE: Answer = { status: 503, body: { error: 'offline', status: 503 } };

/** What the queue holds, as `press start` / `hit`, in the order it will be sent. */
export async function queued(): Promise<string[]> {
  const rows = await db.outbox.orderBy('id').toArray();
  return rows.map((row) => (row.kind === 'press' ? `press ${row.pressAction}` : 'hit'));
}

/** What the inbox holds, the same way. */
export async function heldRows(): Promise<string[]> {
  const rows = await db.rejected.orderBy('id').toArray();
  return rows.map((row) => (row.kind === 'press' ? `press ${row.pressAction}` : 'hit'));
}
