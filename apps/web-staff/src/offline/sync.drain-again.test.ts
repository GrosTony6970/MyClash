/**
 * A hit or a card queued while the pad sends goes in the same send.
 *
 * A send walks the list it read at its start, and a send asked for while one
 * ran answered at once and did nothing. So a card given while a hit was on its
 * way stayed on the tablet until the next hit, Retry or connection event, and
 * the send that ran ended on "could not be synced" though nothing had failed.
 * A send asked for while one runs now means one more pass, and its press waits
 * for it, as for a send of its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { offlineResponse } from './failure-kind';
import { enqueue, getAllPending, getRejected, quarantine, queueCard } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const SAVED = { status: 201, body: { id: 'srv' } };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

type Answer = { status: number; body: unknown };

/** Every POST waits for `answer`; `posted` names each one sent, in order. */
function heldApi() {
  const posted: string[] = [];
  const waiting: Array<(res: unknown) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      posted.push((JSON.parse(init?.body ?? '{}') as { clientUuid: string }).clientUuid);
      return new Promise((resolve) => waiting.push(resolve));
    }),
  );
  const answer = async ({ status, body }: Answer) => {
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    waiting.shift()?.({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { posted, answer };
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

/** An engine whose send of the hit `uuid-1` waits on the server, `behind` more hits after it. */
async function sending(behind = 0) {
  const api = heldApi();
  await addHit(1, 'uuid-1');
  for (let i = 2; i < behind + 2; i += 1) await addHit(i, `uuid-${i}`);
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  const first = engine.drain();
  await vi.waitFor(() => expect(api.posted).toEqual(['uuid-1']));
  return { ...api, engine, states, first };
}

describe('a card given while a hit is on its way', () => {
  it('goes in the same send, after the hit, and the bar never says "could not be synced"', async () => {
    const { engine, states, first, posted, answer } = await sending();

    await queueCard({ matchId: 'm1', sequence: 2, registrationId: 'reg-red', directCard: 'red' });
    const second = engine.drain();
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    await answer(SAVED);
    await Promise.all([first, second]);

    expect(posted[0]).toBe('uuid-1');
    expect(await getAllPending()).toHaveLength(0);
    expect(await db.synced.count()).toBe(2);
    expect(states.map((state) => state.status)).not.toContain('error');
    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('keeps its press waiting until the card itself is answered', async () => {
    const { engine, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    let answered = false;
    const second = engine.drain().then(() => {
      answered = true;
    });

    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toEqual(['uuid-1', 'uuid-2']));

    expect(answered, 'the screen would read its lists before the server has the hit').toBe(false);
    expect(engine.isDraining()).toBe(true);
    await answer(SAVED);
    await Promise.all([first, second]);
    expect(engine.isDraining()).toBe(false);
  });

  it('sends nothing twice when the send in flight already took it', async () => {
    const { engine, first, posted, answer } = await sending(1);

    const second = engine.drain();
    await answer(SAVED);
    await answer(SAVED);
    await Promise.all([first, second]);

    expect(posted).toEqual(['uuid-1', 'uuid-2']);
  });
});

describe('a send that stops', () => {
  it('for who sends it leaves the new hit waiting behind the first, and asks nothing more', async () => {
    const { engine, states, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    const second = engine.drain();

    await answer({ status: 403, body: { message: 'in English', code: 'account_cannot_score' } });
    await Promise.all([first, second]);

    expect(posted, 'the hit behind meets the same answer').toEqual(['uuid-1']);
    expect(states.at(-1)).toMatchObject({ status: 'account-refused', pendingCount: 2 });
    expect(engine.isDraining()).toBe(false);
  });

  it('for a dead network leaves the new hit waiting too', async () => {
    const offline = offlineResponse();
    const down = { status: offline.status, body: await offline.json() };
    const { engine, states, first, posted, answer } = await sending(2);

    await addHit(4, 'uuid-4');
    const second = engine.drain();
    await answer(down);
    await answer(down);
    await answer(down);
    await Promise.all([first, second]);

    expect(posted).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 4 });
  });

  it('is asked again by the next press, which sends the queue in order', async () => {
    const { engine, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    const second = engine.drain();
    await answer({ status: 403, body: { code: 'account_cannot_score' } });
    await Promise.all([first, second]);

    const third = engine.drain();
    await answer(SAVED);
    await answer(SAVED);
    await third;

    expect(posted).toEqual(['uuid-1', 'uuid-1', 'uuid-2']);
    expect(await getAllPending()).toHaveLength(0);
  });
});

describe('the other ways a send is asked for while one runs', () => {
  it('Retry of a held hit sends it after the hit in flight', async () => {
    await quarantine(await addHit(7, 'uuid-held'), 'Match is locked');
    const heldId = (await getRejected())[0]!.id as number;
    const { engine, first, posted, answer } = await sending();

    const retried = engine.retryRejectedEntry(heldId);
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    await answer(SAVED);
    await Promise.all([first, retried]);

    expect(posted).toEqual(['uuid-1', 'uuid-held']);
    expect(await getRejected()).toHaveLength(0);
  });
});

describe('a send that throws', () => {
  it('leaves the pad able to send again', async () => {
    const api = heldApi();
    await addHit(1, 'uuid-1');
    const engine = new SyncEngine(API_URL);
    const leave = engine.subscribe(() => {
      throw new Error('a listener broke');
    });

    await expect(engine.drain()).rejects.toThrow('a listener broke');
    leave();
    expect(engine.isDraining()).toBe(false);

    const again = engine.drain();
    await api.answer(SAVED);
    await again;
    expect(api.posted).toEqual(['uuid-1']);
  });
});
