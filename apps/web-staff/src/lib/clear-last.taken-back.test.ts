import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../offline/db';
import { takeBack } from '../offline/take-back';
import { undoLastEntry } from './clear-last';

/**
 * An entry an earlier undo took off the tablet is not undone twice.
 *
 * He undid hit 5 with no connection: it is written down, and the server still
 * holds it. The wifi is back and he taps Undo again before the pad settled
 * hit 5. The tap read hit 5 as the server's newest entry and voided it, the
 * settle voided it too, and one of the two read "already voided". Hit 4, the
 * one he meant, stayed.
 */
const API_URL = 'http://localhost:4000';
const t = (key: string) => key;

beforeEach(async () => {
  await db.outbox.clear();
  await db.undone.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
/** A hit as the server lists it, scored at `minute`, under the tablet's id of that minute. */
const held = (minute: number) => ({
  id: `ex-${minute}`,
  client_uuid: `uuid-${minute}`,
  voided: false,
  sequence: minute,
  occurred_at: `2026-10-06T10:0${minute}:00.000Z`,
});

/** The server holds `hits`. `duringTheRead` runs while the undo reads the bout. */
function server(hits: unknown[], duringTheRead: () => Promise<unknown> = async () => undefined) {
  const voided: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const path = url.replace(`${API_URL}/api/v1`, '');
      if (init?.method === 'PATCH') {
        voided.push(path);
        return json({ voided: true });
      }
      if (path.endsWith('/penalty-ruleset')) return duringTheRead().then(() => json({}));
      return json(path.endsWith('/penalties') ? [] : hits);
    }),
  );
  return voided;
}

const tookBack = (minute: number) =>
  db.undone.put({ clientUuid: `uuid-${minute}`, matchId: 'm1', undoneAt: Date.now() });
const writtenDown = async () => (await db.undone.toArray()).map((entry) => entry.clientUuid);
const undo = () => undoLastEntry({ apiUrl: API_URL, matchId: 'm1', t, takeBack });

describe('an entry an earlier undo took off the tablet', () => {
  it('is not undone again: the tap takes back the entry before it', async () => {
    await tookBack(5);
    const voided = server([held(4), held(5)]);

    await expect(undo()).resolves.toEqual({ kind: 'voided' });

    expect(voided).toEqual(['/exchanges/ex-4/void']);
    expect(await writtenDown()).toEqual(['uuid-5']);
  });

  // The race: the settle voids hit 5 and forgets it while the tap reads the server.
  it('is still left out when the settle forgets it during the read', async () => {
    await tookBack(5);
    const voided = server([held(4), held(5)], () => db.undone.clear());

    await expect(undo()).resolves.toEqual({ kind: 'voided' });

    expect(voided).toEqual(['/exchanges/ex-4/void']);
  });

  it('leaves nothing to undo when it was the only entry of the bout', async () => {
    await tookBack(5);
    const voided = server([held(5)]);

    await expect(undo()).resolves.toEqual({ kind: 'failed', message: null });
    expect(voided).toEqual([]);
  });

  it('does not hide an entry of the bout that nobody took back', async () => {
    await tookBack(3);
    const voided = server([held(4), held(5)]);

    await undo();

    expect(voided).toEqual(['/exchanges/ex-5/void']);
  });
});
