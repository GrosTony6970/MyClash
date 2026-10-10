/**
 * A hit or a card the server refuses stops the rows of its own bout behind it
 * (operator, 2026-10-10), as a refused clock press does
 * (`sync.press-order.test.ts`).
 *
 * The story: hit 1, hit 2, hit 3, then "End match", with no network. The
 * server refuses hit 2. Sent on, hit 3 and the End ended the bout on the server
 * without hit 2, perhaps with the wrong winner. The older ruling ("a held hit
 * stops nothing") was made before an End was in the queue.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { getRejected } from './outbox';
import { boutsBehindHeldRow, heldPressesOf, heldRowsOf, waitingBehind } from './press-queue';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  addCard,
  addHit,
  addPress,
  clearStore,
  heldRows,
  mockServer,
  queued,
  refused,
} from './sync.press.fixtures';

beforeEach(clearStore);

describe('a hit the server refuses', () => {
  // Hit 1, hit 2, hit 3, then "End match", with no network. The server refuses
  // hit 2. Sent on, hit 3 and the End would end the bout without it.
  async function boutWithARefusedHit(matchId = 'm1') {
    await addHit(matchId, `${matchId}-hit-1`);
    await addHit(matchId, `${matchId}-hit-2`);
    await addHit(matchId, `${matchId}-hit-3`);
    await addPress('end', matchId, 60);
  }
  const secondHitOf = (matchId: string) => {
    let hits = 0;
    return (call: string) => {
      if (call !== `exchanges ${matchId}`) return undefined;
      hits += 1;
      return hits === 2 ? refused(409, 'match_locked') : undefined;
    };
  };

  it('stops the rows of its bout behind it, in this send and in the next', async () => {
    await boutWithARefusedHit();
    const { calls } = mockServer(secondHitOf('m1'));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();
    await engine.drain();

    expect(calls, 'hit 3 and the End were never tried').toEqual(['exchanges m1', 'exchanges m1']);
    expect(await heldRows()).toEqual(['hit']);
    expect(await queued()).toEqual(['hit', 'press end']);
    expect(states.at(-1)).toMatchObject({
      status: 'error',
      pendingCount: 2,
      rejectedCount: 1,
      // Nothing a send can try: the bar offers Review, not a Retry that sends nothing.
      freeCount: 0,
    });
    // Waiting behind a held hit is no failed try.
    const rows = await db.outbox.toArray();
    expect(rows.map((row) => row.attempts)).toEqual([0, 0]);
  });

  it('lets another bout go on', async () => {
    await boutWithARefusedHit('m1');
    await addHit('m2', 'm2-hit-1');
    const { calls } = mockServer(secondHitOf('m1'));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['exchanges m1', 'exchanges m1', 'exchanges m2']);
  });

  it('is counted with the rows that wait behind it, for the inbox and the bout’s screen', async () => {
    await boutWithARefusedHit('m1');
    await addHit('m2', 'm2-hit-1');
    mockServer(secondHitOf('m1'));
    await new SyncEngine(API_URL).drain();

    const [held] = await heldRowsOf('m1');

    expect(held).toMatchObject({ clientUuid: 'm1-hit-2', rejectedCode: 'match_locked' });
    expect(await waitingBehind(held!)).toBe(2);
    expect([...(await boutsBehindHeldRow())]).toEqual(['m1']);
    expect(await heldRowsOf('m2')).toEqual([]);
    expect(await heldPressesOf('m1'), 'a hit is no press').toEqual([]);
  });

  it('a card the server refuses stops its bout the same way, in this send and in the next', async () => {
    await addCard('m1');
    await addPress('end', 'm1', 60);
    const { calls } = mockServer((call) =>
      call === 'penalties m1' ? refused(409, 'match_locked') : undefined,
    );
    const engine = new SyncEngine(API_URL);

    await engine.drain();
    await engine.drain();

    expect(calls).toEqual(['penalties m1']);
    expect(await queued()).toEqual(['press end']);
  });
});

describe('a hit that stays queued while the hit after it is refused', () => {
  // Hit 1 meets a server fault and stays queued. Hit 2 goes (two hits do not
  // depend on each other) and is refused. Hit 1 now waits behind hit 2,
  // though its place in the queue is before it.
  async function firstFaultsSecondRefused() {
    await addHit('m1', 'hit-1');
    await addHit('m1', 'hit-2');
    let fault = true;
    const server = mockServer((_call, nth) => {
      if (nth === 1 && fault) return { status: 502, body: {} };
      return nth === 2 ? refused(409, 'match_locked') : undefined;
    });
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    fault = false;
    const [held] = await getRejected();
    return { ...server, engine, held: held! };
  }

  it('is counted as waiting behind it', async () => {
    const { held } = await firstFaultsSecondRefused();

    expect(held.clientUuid).toBe('hit-2');
    expect(await waitingBehind(held)).toBe(1);
  });

  it('is sent by the Discard of the held hit', async () => {
    const { engine, held, calls } = await firstFaultsSecondRefused();

    await engine.discardRejectedEntry(held.id as number);

    expect(calls).toEqual(['exchanges m1', 'exchanges m1', 'exchanges m1']);
    expect(await queued()).toEqual([]);
  });
});

describe('what a send can try', () => {
  it('counts the rows of the bouts that hold no refused row', async () => {
    await addHit('m1', 'hit-1');
    await addHit('m1', 'hit-2');
    await addHit('m2', 'other-1');
    // The network holds for one call, the refused hit of m1, then drops.
    mockServer((_call, nth) =>
      nth === 1 ? refused(409, 'match_locked') : { status: 503, body: { error: 'offline' } },
    );
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();

    expect(states.at(-1)).toMatchObject({ pendingCount: 2, rejectedCount: 1, freeCount: 1 });
  });

  it('is every queued row while the inbox holds none', async () => {
    await addHit('m1', 'hit-1');
    await addHit('m2', 'other-1');
    mockServer(() => ({ status: 503, body: { error: 'offline' } }));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();

    expect(states.at(-1)).toMatchObject({ pendingCount: 2, rejectedCount: 0, freeCount: 2 });
  });
});

describe('Discard of a held hit', () => {
  it('with nothing of its bout behind it, sends nothing', async () => {
    await addHit('m1', 'hit-1');
    const { calls } = mockServer(() => refused(409, 'event_results_frozen'));
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    await addHit('m2', 'other-1');
    const [held] = await getRejected();

    await engine.discardRejectedEntry(held!.id as number);

    expect(calls, 'the hit of the other bout was not sent by the Discard').toEqual([
      'exchanges m1',
    ]);
    expect(await heldRows()).toEqual([]);
  });

  it('frees the rows of its bout, and sends them at once', async () => {
    await addHit('m1', 'hit-1');
    await addPress('end', 'm1', 60);
    const { calls } = mockServer((call) =>
      call === 'exchanges m1' ? refused(409, 'match_locked') : undefined,
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    const [held] = await getRejected();

    await engine.discardRejectedEntry(held!.id as number);

    expect(calls).toEqual(['exchanges m1', 'clock m1 end']);
    expect(await heldRows()).toEqual([]);
    expect(await queued()).toEqual([]);
  });
});
