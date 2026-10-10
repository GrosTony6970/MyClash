/**
 * A table with no wifi: the official starts the clock, scores, and ends the
 * bout. The tablet's queue holds the clock presses with the hits, in the order
 * of the bout. These helpers put such a queue in the store and stand in for
 * the server.
 */
import { vi } from 'vitest';
import type { ClockPress } from '@myclash/types';
import { db, type OutboxEntry, type RoundPress } from './db';
import { enqueue } from './outbox';
import { queuePress, queueRoundPress } from './press-queue';

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

/** "Start round `round`" or "End round `round`" of bout `matchId`, `secondsAfterTen` after 10:00. */
export function addRound(
  action: RoundPress,
  round: number,
  matchId = 'm1',
  secondsAfterTen = 0,
): Promise<OutboxEntry> {
  const ms = secondsAfterTen * 1000;
  return queueRoundPress(
    { matchId, action, round, bout: BOUT },
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

export function addCard(matchId = 'm1', clientUuid = crypto.randomUUID()): Promise<number> {
  return enqueue({
    kind: 'penalty',
    clientUuid,
    matchId,
    sequence: 1,
    registrationId: 'reg-1',
    occurredAt: new Date(AT_TEN.wall).toISOString(),
    directCard: 'yellow',
    reason: 'Excessive force',
    bout: BOUT,
  });
}

/** One call the tablet made: its door, the bout, and for a press its button. */
export type Call = `${'clock' | 'exchanges'} ${string}${string}`;

export interface Answer {
  status: number;
  body?: unknown;
}

/** How the server answers a write it takes: a clock, the open round, or the saved row's id. */
function taken(door: string, matchId: string, nth: number): Answer {
  if (door === 'clock') return { status: 200, body: { status: 'running', matchId } };
  if (door === 'rounds/advance') return { status: 200, body: { currentRound: 2 } };
  if (door === 'rounds/end') return { status: 200, body: { redScore: 0, blueScore: 0 } };
  return { status: 201, body: { id: `saved-${nth}` } };
}

/** One write as `clock m1 start`, `rounds/advance m1 2` or `exchanges m1`. */
function callOf(door: string, matchId: string, body: Record<string, unknown>): string {
  if (door === 'clock') return `clock ${matchId} ${String(body['action'])}`;
  if (door.startsWith('rounds/')) return `${door} ${matchId} ${String(body['round'])}`;
  return `${door} ${matchId}`;
}

/**
 * The server. `answer` says how each write is answered, from the call as
 * `clock m1 start`, `rounds/advance m1 2` or `exchanges m1`; with none, every
 * write is taken. A GET lists no row (the read before a second try of a hit).
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
      const [, matchId, door] = /matches\/([^/]+)\/([\w/]+)$/.exec(url) ?? [];
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      const call = callOf(String(door), String(matchId), body);
      calls.push(call);
      bodies.push(body);
      const said = answer(call, calls.length) ?? taken(String(door), String(matchId), calls.length);
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

/** A row as `press start`, `round advance 2` or `hit`. */
function named(row: OutboxEntry): string {
  if (row.kind === 'press') return `press ${row.pressAction}`;
  if (row.kind === 'round') return `round ${row.roundAction} ${row.round}`;
  return 'hit';
}

/** What the queue holds, as `press start` / `round advance 2` / `hit`, in the order it will be sent. */
export async function queued(): Promise<string[]> {
  const rows = await db.outbox.orderBy('id').toArray();
  return rows.map(named);
}

/** What the inbox holds, the same way. */
export async function heldRows(): Promise<string[]> {
  const rows = await db.rejected.orderBy('id').toArray();
  return rows.map(named);
}
