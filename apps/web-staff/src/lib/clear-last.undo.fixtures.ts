/**
 * The server and the tablet of `clear-last.undo.test.ts`: a bout `m1` whose
 * hits, cards and protests the server lists, and the entries that wait on the
 * tablet. Its own file: the test file is at its length cap.
 */
import { vi } from 'vitest';
import { db, type OutboxEntry } from '../offline/db';
import { enqueue, getPendingForMatch } from '../offline/outbox';
import { takeBack, type TakenBack } from '../offline/take-back';
import { undoLastEntry } from './clear-last';

export const API_URL = 'http://localhost:4000';
const t = (key: string) => key;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
export const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;
export const uuid = (minute: number) => `uuid-${minute}`;
/** A hit, card or protest as the server lists it, scored at `minute`, under the tablet's id of that minute. */
export const held = (id: string, minute: number, over: object = {}) => ({
  id,
  client_uuid: uuid(minute),
  voided: false,
  sequence: minute,
  occurred_at: at(minute),
  ...over,
});

interface Server {
  /** One answer per read of the hits: the last one is repeated. */
  hits?: unknown[][];
  cards?: unknown[];
  protests?: unknown[];
  mayScore?: () => Response | Promise<Response>;
  voids?: () => Response;
}

export function server({ hits = [[]], cards = [], protests = [], mayScore, voids }: Server) {
  const calls: Array<[string, string]> = [];
  let read = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const path = url.replace(`${API_URL}/api/v1`, '');
      calls.push([init?.method ?? 'GET', path]);
      if (init?.method === 'PATCH') return (voids ?? (() => json(200, { voided: true })))();
      if (path.endsWith('/penalty-ruleset')) return (mayScore ?? (() => json(200, {})))();
      if (path.endsWith('/penalties')) return json(200, cards);
      if (path.endsWith('/protests')) return json(200, protests);
      read += 1;
      return json(200, hits[Math.min(read, hits.length) - 1]);
    }),
  );
  const asked = (method: string) => calls.filter(([verb]) => verb === method).map(([, to]) => to);
  return { asked };
}

/** A hit that waits on the tablet, scored at `minute`. */
export const waits = (minute: number) =>
  enqueue({
    clientUuid: uuid(minute),
    matchId: 'm1',
    sequence: minute,
    type: 'clean',
    occurredAt: at(minute),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
export const waiting = async () =>
  (await getPendingForMatch('m1')).map((entry) => entry.clientUuid);
export const writtenDown = async () => (await db.undone.toArray()).map((entry) => entry.clientUuid);
export const undo = (take: (entry: OutboxEntry) => Promise<TakenBack> = takeBack) =>
  undoLastEntry({ apiUrl: API_URL, matchId: 'm1', t, takeBack: take });
/** The undo's read of the bout: who may score it, then its hits, cards and protests. */
export const BOUT_READ = [
  '/matches/m1/penalty-ruleset',
  '/matches/m1/exchanges',
  '/matches/m1/penalties',
  '/matches/m1/protests',
];
/** The undo's answer names the entry it took: by the server's id when the server held it. */
export const voided = (minute: number, id?: string) => ({
  kind: 'voided',
  entry: id ? { id, clientUuid: uuid(minute) } : { clientUuid: uuid(minute) },
});
