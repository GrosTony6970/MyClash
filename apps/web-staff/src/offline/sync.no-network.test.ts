/**
 * A send that met only "no network" says `offline`, with one entry as with ten
 * (operator, 2026-10-12).
 *
 * The bar was red "SYNC ERROR" over one or two entries a dead network kept on
 * the tablet, and grey "OFFLINE" over three: only three failures in a row said
 * `offline`, and a pass that walked the whole queue said `error` whatever its
 * failures were. A hall with wifi and no internet read as a fault of the
 * server. Red is for an answer of the server, and for an entry it refused.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { quarantine } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  OFFLINE,
  addHit,
  addPress,
  clearStore,
  mockServer,
  type Answer,
} from './sync.press.fixtures';

const FAULT: Answer = { status: 500, body: { message: 'boom' } };

beforeEach(clearStore);

async function sent(answer: (call: string) => Answer | undefined): Promise<SyncState | undefined> {
  mockServer(answer);
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  await engine.drain();
  return states.at(-1);
}

describe('a send that met only "no network"', () => {
  it('says offline over one entry', async () => {
    await addHit();

    expect(await sent(() => OFFLINE)).toMatchObject({ status: 'offline', pendingCount: 1 });
  });

  it('says offline over a press and the hit that waits behind it', async () => {
    await addPress('start');
    await addHit();

    const server = mockServer(() => OFFLINE);
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    await engine.drain();

    // The hit was not tried: it waits behind the Start of its bout.
    expect(server.calls).toEqual(['clock m1 start']);
    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 2 });
  });
});

describe('a send the server answered with a fault', () => {
  it('says error over one entry', async () => {
    await addHit();

    expect(await sent(() => FAULT)).toMatchObject({ status: 'error', pendingCount: 1 });
  });

  it('says error when one entry met a fault and another met no network', async () => {
    await addHit('m1');
    await addHit('m2');

    const last = await sent((call) => (call === 'exchanges m1' ? OFFLINE : FAULT));

    expect(last).toMatchObject({ status: 'error', pendingCount: 2 });
  });
});

describe('a fault of the server, then a dead network', () => {
  it('says offline at the next send: the fault of the send before is not remembered', async () => {
    await addHit();
    let down = false;
    mockServer(() => (down ? OFFLINE : FAULT));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();
    expect(states.at(-1)?.status).toBe('error');
    down = true;
    await engine.drain();

    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 1 });
  });
});

describe('a send that tried nothing', () => {
  it('says error while the entries wait behind a refused one of their bout', async () => {
    await quarantine(await addHit('m1'), 'Match is locked');
    await addHit('m1');

    const server = mockServer();
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    await engine.drain();

    expect(server.calls).toEqual([]);
    expect(states.at(-1)).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 1 });
  });

  it('keeps error over a refused entry when another bout met no network', async () => {
    await quarantine(await addHit('m1'), 'Match is locked');
    await addHit('m2');

    const last = await sent(() => OFFLINE);

    expect(last).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 1 });
  });
});
