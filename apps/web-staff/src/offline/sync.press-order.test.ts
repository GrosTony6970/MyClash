/**
 * The order of a bout's rows around its clock presses (operator, 2026-10-10:
 * "a press the server refuses stops the rows of its own bout behind it; other
 * bouts keep sending").
 *
 * The server judges each row against the bout as it is when the row arrives: a
 * hit is refused on a bout nobody started, and an End names the winner from
 * the hits the server holds. A queue that let a hit pass a Start that did not
 * go would turn one refusal into a refused bout.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { getRejected, quarantine, requeueRejected } from './outbox';
import { boutsBehindHeldRow, heldPressesOf, waitingBehind } from './press-queue';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  OFFLINE,
  addHit,
  addPress,
  clearStore,
  heldRows,
  mockServer,
  queued,
  refused,
} from './sync.press.fixtures';

beforeEach(clearStore);

const REFUSED = refused(409, 'clock_press_out_of_order');

/** A bout pressed with no network: Start, a hit, End. */
async function wholeBout(matchId = 'm1') {
  await addPress('start', matchId, 0);
  await addHit(matchId);
  await addPress('end', matchId, 60);
}

describe('a bout sent in its order', () => {
  it('goes Start, hit, End', async () => {
    await wholeBout();
    const { calls } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start', 'exchanges m1', 'clock m1 end']);
    expect(await queued()).toEqual([]);
  });
});

describe('a press the server refuses', () => {
  it('stops the rows of its bout behind it, in this send and in the next', async () => {
    await wholeBout();
    const { calls } = mockServer((call) => (call === 'clock m1 start' ? REFUSED : undefined));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();
    await engine.drain();

    expect(calls, 'the hit and the End were never tried').toEqual(['clock m1 start']);
    expect(await heldRows()).toEqual(['press start']);
    expect(await queued()).toEqual(['hit', 'press end']);
    expect(states.at(-1)).toMatchObject({ status: 'error', pendingCount: 2, heldPressCount: 1 });
    // Waiting behind a held press is no failed try.
    const rows = await db.outbox.toArray();
    expect(rows.map((row) => row.attempts)).toEqual([0, 0]);
  });

  it('lets another bout go on', async () => {
    await wholeBout('m1');
    await wholeBout('m2');
    const { calls } = mockServer((call) => (call === 'clock m1 start' ? REFUSED : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start', 'clock m2 start', 'exchanges m2', 'clock m2 end']);
  });

  it('is counted with the rows that wait behind it, for the inbox and the bout’s screen', async () => {
    await wholeBout('m1');
    await addHit('m2');
    mockServer((call) => (call.startsWith('clock m1') ? REFUSED : undefined));
    await new SyncEngine(API_URL).drain();

    const [held] = await heldPressesOf('m1');

    expect(held).toMatchObject({ pressAction: 'start', rejectedCode: 'clock_press_out_of_order' });
    expect(await waitingBehind(held!)).toBe(2);
    expect([...(await boutsBehindHeldRow())]).toEqual(['m1']);
    expect(await heldPressesOf('m2')).toEqual([]);
  });
});

describe('Retry of a held press', () => {
  it('puts it back at ITS place: it goes before the rows that waited behind it', async () => {
    await wholeBout();
    let refuse = true;
    const { calls } = mockServer((call) =>
      refuse && call === 'clock m1 start' ? REFUSED : undefined,
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    const [held] = await getRejected();

    refuse = false;
    expect(await engine.retryRejectedEntry(held!.id as number)).toBe(true);

    expect(calls).toEqual(['clock m1 start', 'clock m1 start', 'exchanges m1', 'clock m1 end']);
    expect(await queued()).toEqual([]);
    expect(await heldRows()).toEqual([]);
  });

  it('keeps its id, so the server takes it once whatever it answered before', async () => {
    const row = await addPress('start');
    let refuse = true;
    const { bodies } = mockServer(() => (refuse ? REFUSED : undefined));
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    refuse = false;
    await engine.retryRejected();

    expect(bodies.map((body) => body['clientUuid'])).toEqual([row.clientUuid, row.clientUuid]);
  });

  it('Retry on the bar puts every curable press back at its place, and gives it no sequence', async () => {
    await wholeBout();
    mockServer((call) => (call === 'clock m1 start' ? REFUSED : undefined));
    await new SyncEngine(API_URL).drain();

    expect(await requeueRejected()).toBe(1);

    expect(await queued()).toEqual(['press start', 'hit', 'press end']);
    const [start, hit] = await db.outbox.orderBy('id').toArray();
    expect(start?.sequence).toBe(0);
    expect(hit?.sequence, 'the hit keeps the number it had').toBe(1);
  });

  it('takes no number from the hit that goes back with it', async () => {
    // Held one after the other: the hit first (its Event was closed for a moment), then the press.
    const press = await addPress('halt');
    const hitId = await addHit('m1', 'hit-1');
    await quarantine(hitId, 'refused', 'event_results_frozen');
    await quarantine(press.id as number, 'refused', 'clock_press_out_of_order');

    expect(await requeueRejected()).toBe(2);

    const rows = await db.outbox.orderBy('id').toArray();
    const hit = rows.find((row) => row.clientUuid === 'hit-1');
    expect(hit?.sequence, 'the press before it used no number').toBe(1);
    expect(rows.find((row) => row.kind === 'press')?.sequence).toBe(0);
  });

  it('a press made more than a day before its send is not sent again: it only gets older', async () => {
    await addPress('halt');
    const { calls } = mockServer(() => refused(409, 'clock_press_too_old'));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    await engine.drain();

    expect(await engine.retryRejected()).toBe(0);

    expect(calls).toEqual(['clock m1 halt']);
    expect(states.at(-1)).toMatchObject({ rejectedCount: 1, sendableCount: 0 });
  });
});

describe('Retry of a held hit', () => {
  it('puts it back at its place: before the End of its bout that was pressed after it', async () => {
    // The hit is refused for a moment (its bout was locked); the official goes on to the End.
    await addPress('start', 'm1', 0);
    await addHit('m1', 'hit-1');
    let network: 'locked' | 'up' = 'locked';
    const { calls } = mockServer((call) => {
      return network === 'locked' && call === 'exchanges m1'
        ? refused(409, 'match_locked')
        : undefined;
    });
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    expect(await heldRows()).toEqual(['hit']);
    await addPress('end', 'm1', 60);
    await engine.drain();
    expect(await queued(), 'the End waits behind the held hit').toEqual(['press end']);
    const [held] = await getRejected();

    network = 'up';
    await engine.retryRejectedEntry(held!.id as number);

    expect(calls.slice(-2), 'the hit reaches the server before the End').toEqual([
      'exchanges m1',
      'clock m1 end',
    ]);
    expect(await queued()).toEqual([]);
  });
});

describe('Discard of a held press', () => {
  it('frees the rows of its bout, and sends them at once', async () => {
    await wholeBout();
    const { calls } = mockServer((call) => (call === 'clock m1 start' ? REFUSED : undefined));
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    const [held] = await getRejected();

    await engine.discardRejectedEntry(held!.id as number);

    expect(calls).toEqual(['clock m1 start', 'exchanges m1', 'clock m1 end']);
    expect(await heldRows()).toEqual([]);
    expect(await queued()).toEqual([]);
  });
});

describe('a press that could not be sent', () => {
  it('stops the rows of its bout for this send: a hit must not pass a Start that did not go', async () => {
    await addPress('start', 'm1');
    await addHit('m1');
    await addHit('m2');
    // The network drops for one call: the Start of m1.
    const { calls } = mockServer((call, nth) => (nth === 1 ? OFFLINE : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls, 'the hit of m1 was not tried; the other bout went on').toEqual([
      'clock m1 start',
      'exchanges m2',
    ]);
    expect(await queued()).toEqual(['press start', 'hit']);
  });

  it('counts a row that waits behind it as the same failure: three in a row end the send', async () => {
    // One bout of three rows, then another bout. With no network the Start
    // fails and two rows wait: that is three, and the send stops as "offline",
    // as it does for three hits. A send that went on would say "sync error".
    await wholeBout('m1');
    await addHit('m2');
    const { calls } = mockServer((call) => (call.includes('m1') ? OFFLINE : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start']);
  });

  it('goes with its bout at the next send', async () => {
    await wholeBout();
    let down = true;
    const { calls } = mockServer(() => (down ? OFFLINE : undefined));
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    down = false;
    await engine.drain();

    expect(calls).toEqual(['clock m1 start', 'clock m1 start', 'exchanges m1', 'clock m1 end']);
  });

  it('says "offline" after three rows that met no network, the ones that waited included', async () => {
    await wholeBout();
    mockServer(() => OFFLINE);
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();

    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 3 });
  });

  it('keeps stopping its bout behind a row that waited: the second hit does not go either', async () => {
    await addPress('start', 'm1');
    await addHit('m1', 'hit-1');
    await addHit('m1', 'hit-2');
    const { calls } = mockServer((call, nth) => (nth === 1 ? OFFLINE : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start']);
    expect(await queued()).toEqual(['press start', 'hit', 'hit']);
  });

  it('behind a server fault, the rows that wait do not end the send: another bout goes on', async () => {
    // The bout m1 was deleted on the server, or its row answers a fault for a while.
    await wholeBout('m1');
    await addHit('m2');
    const { calls } = mockServer((call) =>
      call.includes('m1') ? { status: 502, body: {} } : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start', 'exchanges m2']);
    expect(await queued()).toEqual(['press start', 'hit', 'press end']);
  });

  it('a server fault on a press stops its bout the same way', async () => {
    await wholeBout();
    const { calls } = mockServer((call, nth) =>
      nth === 1 ? { status: 502, body: {} } : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start']);
  });
});

describe('a hit that could not be sent', () => {
  it('holds back a press behind it: an End must not name the winner without that hit', async () => {
    await addPress('start', 'm1', 0);
    await addHit('m1');
    await addPress('end', 'm1', 60);
    const { calls } = mockServer((call) => (call === 'exchanges m1' ? OFFLINE : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start', 'exchanges m1']);
    expect(await queued()).toEqual(['hit', 'press end']);
  });

  it('does not hold back a hit behind it: two hits do not depend on each other', async () => {
    await addHit('m1', 'hit-1');
    await addHit('m1', 'hit-2');
    const { calls } = mockServer((call, nth) => (nth === 1 ? OFFLINE : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['exchanges m1', 'exchanges m1']);
    expect(await queued()).toEqual(['hit']);
  });
});
