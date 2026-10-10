/**
 * A clock press in the tablet's queue: how it is sent, and what each answer of
 * the server does to it (operator rulings 11 to 14 of the quick-win list).
 *
 * The order of a bout's rows is `sync.press-order.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { hearSessionEnded } from './caller-refusal';
import { db } from './db';
import { getRejected, nextSequence } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  AT_TEN,
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

function watched() {
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  return { engine, states, last: () => states.at(-1) };
}

describe('a press written on the tablet', () => {
  it('is a row of the queue with its button, its bout, its id and the tablet’s two clocks', async () => {
    const row = await addPress('start');

    expect(await db.outbox.get(row.id as number)).toMatchObject({
      kind: 'press',
      pressAction: 'start',
      matchId: 'm1',
      occurredAt: '2026-10-10T10:00:00.000Z',
      pressedPerf: AT_TEN.page,
      pressOrigin: AT_TEN.origin,
      bout: { label: 'P1', red: 'Ana Red', blue: 'Bo Blue' },
      attempts: 0,
    });
    expect(row.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes no number of the bout’s sequence', async () => {
    await addHit();
    const before = await nextSequence('m1');

    const row = await addPress('halt');

    expect(row.sequence).toBe(0);
    expect(await nextSequence('m1')).toBe(before);
  });
});

describe('the send of a press', () => {
  it('goes to the clock’s door with its button, its id and its two times', async () => {
    const row = await addPress('start');
    const { calls, bodies } = mockServer();
    vi.spyOn(Date, 'now').mockReturnValue(AT_TEN.wall + 20 * 60_000);

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['clock m1 start']);
    expect(bodies[0]).toEqual({
      action: 'start',
      clientUuid: row.clientUuid,
      pressedAt: '2026-10-10T10:00:00.000Z',
      sentAt: '2026-10-10T10:20:00.000Z',
    });
  });

  it('leaves the queue when the server takes it, and nothing is kept of it', async () => {
    await addPress('start');
    mockServer();
    const { engine, last } = watched();

    await engine.drain();

    expect(await queued()).toEqual([]);
    expect(await db.synced.count(), 'a press is never undone: no record is needed').toBe(0);
    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
  });

  it('tells the screen the clock the server answered with, BEFORE the press leaves the queue', async () => {
    const row = await addPress('start');
    mockServer(() => ({ status: 200, body: { status: 'running', activeMs: 0 } }));
    const engine = new SyncEngine(API_URL);
    const heard: Array<{ press: unknown; clock: unknown }> = [];
    let queuedWhenTold: Promise<number> | undefined;
    engine.onPressSent((press, clock) => {
      heard.push({ press, clock });
      // Asked at the moment of the call: the store answers its requests in the
      // order they were made, so this count is from before the engine's delete.
      queuedWhenTold = db.outbox.count();
    });

    await engine.drain();

    expect(heard).toEqual([
      {
        press: { matchId: 'm1', clientUuid: row.clientUuid },
        clock: { status: 'running', activeMs: 0 },
      },
    ]);
    // Told after, the screen would show for a moment the clock from before the press.
    expect(await queuedWhenTold).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a listener that throws does not turn a press the server took into a failed one', async () => {
    await addPress('start');
    mockServer();
    const engine = new SyncEngine(API_URL);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.onPressSent(() => {
      throw new Error('the screen broke');
    });

    await engine.drain();

    expect(await queued()).toEqual([]);
  });

  it('a listener that stopped listening is not told', async () => {
    await addPress('start');
    mockServer();
    const engine = new SyncEngine(API_URL);
    const heard = vi.fn();
    engine.onPressSent(heard)();

    await engine.drain();

    expect(heard).not.toHaveBeenCalled();
  });
});

describe('a press the server refuses', () => {
  it.each([
    [409, 'clock_press_out_of_order'],
    [409, 'bout_completed'],
    [409, 'event_results_frozen'],
    [409, 'scored_before_reset'],
    [409, 'clock_press_too_old'],
    [400, 'round_awaits_advance'],
    [400, 'match_locked'],
    [400, 'time_not_finished'],
  ])('a %i %s is held with its code, and its place in the queue', async (status, code) => {
    const row = await addPress('resume');
    const { calls } = mockServer(() => refused(status, code));
    const { engine, last } = watched();

    await engine.drain();

    expect(await queued()).toEqual([]);
    const [held] = await getRejected();
    expect(held).toMatchObject({
      kind: 'press',
      pressAction: 'resume',
      clientUuid: row.clientUuid,
      rejectedCode: code,
      outboxId: row.id,
    });
    expect(calls, 'one send: no other sequence can cure a press').toEqual(['clock m1 resume']);
    expect(last()).toMatchObject({ status: 'error', rejectedCount: 1, heldPressCount: 1 });
  });

  it('a 400 reads no list from the server: a press has no sequence to try again under', async () => {
    await addPress('resume');
    mockServer(() => refused(400, 'round_awaits_advance'));

    await new SyncEngine(API_URL).drain();

    const gets = vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method);
    expect(gets).toHaveLength(0);
  });

  it('a row that collided with another press on the server stays in the queue, and goes at the next send', async () => {
    await addPress('halt');
    let collide = true;
    const { calls } = mockServer(() => (collide ? refused(409, 'clock_row_collided') : undefined));
    const engine = new SyncEngine(API_URL);

    await engine.drain();
    expect(await queued()).toEqual(['press halt']);
    expect(await heldRows(), 'no verdict: nothing is held').toEqual([]);

    collide = false;
    await engine.drain();
    expect(await queued()).toEqual([]);
    expect(calls).toEqual(['clock m1 halt', 'clock m1 halt']);
  });

  it('a held hit says no press is held', async () => {
    await addHit();
    mockServer(() => refused(409, 'event_results_frozen'));
    const { engine, last } = watched();

    await engine.drain();

    expect(last()).toMatchObject({ rejectedCount: 1, heldPressCount: 0 });
  });
});

describe('a press answered "nobody is signed in"', () => {
  it('stays in the queue, and tells the bout’s screen to leave for the sign-in screen (ruling 342)', async () => {
    await addPress('start');
    mockServer(() => ({ status: 401, body: {} }));
    const left = vi.fn();
    const stop = hearSessionEnded(left);
    const { engine, last } = watched();

    await engine.drain();
    stop();

    expect(left).toHaveBeenCalledTimes(1);
    expect(await queued()).toEqual(['press start']);
    expect(await heldRows()).toEqual([]);
    expect(last()).toMatchObject({ status: 'signed-out', pendingCount: 1 });
  });

  it('moves the pad too when the press waits behind the hit that met the answer', async () => {
    // The session ended with a hit in the queue; the official taps Start.
    await addHit();
    await addPress('start');
    const { calls } = mockServer(() => ({ status: 401, body: {} }));
    const left = vi.fn();
    const stop = hearSessionEnded(left);

    await new SyncEngine(API_URL).drain();
    stop();

    expect(calls, 'the send stopped at the hit: the press was never tried').toEqual([
      'exchanges m1',
    ]);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('a hit answered the same way moves nobody: the bar says it (ruling 241)', async () => {
    await addHit();
    mockServer(() => ({ status: 401, body: {} }));
    const left = vi.fn();
    const stop = hearSessionEnded(left);

    await new SyncEngine(API_URL).drain();
    stop();

    expect(left).not.toHaveBeenCalled();
  });
});

describe('a press with no network', () => {
  it('stays in the queue, with one more try counted', async () => {
    const row = await addPress('start');
    mockServer(() => OFFLINE);

    await new SyncEngine(API_URL).drain();

    expect(await queued()).toEqual(['press start']);
    expect((await db.outbox.get(row.id as number))?.attempts).toBe(1);
  });
});
