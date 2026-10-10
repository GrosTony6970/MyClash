/**
 * A best-of bout with no wifi: the official ends round 1, taps "Start round
 * 2", and scores round 2. The two round buttons are rows of the tablet's queue
 * (the offline bout, slice 4b), so the server gets the bout in the order it
 * happened: the hits of round 1, "Start round 2", the hits of round 2.
 *
 * A round press is a press, not an entry: it takes no number of the bout's
 * sequence, nothing else may pass it, and it goes to its own two doors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, isTap } from './db';
import { getRejected, nextSequence, requeueRejected } from './outbox';
import { heldPressesOf, holdsPress, queueRoundPress } from './press-queue';
import { roundPressBody } from './press-send';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  AT_TEN,
  BOUT,
  OFFLINE,
  addHit,
  addPress,
  addRound,
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
  return { engine, last: () => states.at(-1) };
}

/** Round 1 with one hit, "Start round 2", then the clock and one hit of round 2. */
async function twoRounds(matchId = 'm1') {
  await addHit(matchId);
  await addRound('advance', 2, matchId, 60);
  await addPress('resume', matchId, 70);
  await addHit(matchId);
}

describe('a round press written on the tablet', () => {
  it('is a row of the queue with its button, its round, its bout and the tablet’s two clocks', async () => {
    const row = await addRound('advance', 2);

    expect(await db.outbox.get(row.id as number)).toMatchObject({
      kind: 'round',
      roundAction: 'advance',
      round: 2,
      matchId: 'm1',
      occurredAt: '2026-10-10T10:00:00.000Z',
      pressedPerf: AT_TEN.page,
      pressOrigin: AT_TEN.origin,
      bout: BOUT,
      attempts: 0,
    });
    expect(row.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes no number of the bout’s sequence', async () => {
    await addHit();
    const before = await nextSequence('m1');

    const row = await addRound('end', 1);

    expect(row.sequence).toBe(0);
    expect(await nextSequence('m1')).toBe(before);
  });

  it('is a tap as a clock press is; a hit and a card are not', async () => {
    expect(isTap({ kind: 'round' })).toBe(true);
    expect(isTap({ kind: 'press' })).toBe(true);
    expect(isTap({ kind: 'penalty' })).toBe(false);
    expect(isTap({ kind: 'exchange' })).toBe(false);
    expect(isTap({}), 'a row from before the queue knew kinds is a hit').toBe(false);
  });

  it('an "End round" keeps the score it was pressed on', async () => {
    const row = await queueRoundPress({
      matchId: 'm1',
      action: 'end',
      round: 1,
      bout: BOUT,
      endScore: { red: 3, blue: 2 },
    });

    expect(await db.outbox.get(row.id as number)).toMatchObject({ endScore: { red: 3, blue: 2 } });
  });
});

describe('the send of a round press', () => {
  it('"Start round 2" goes to the advance door with its id, its round and its two times', async () => {
    const row = await addRound('advance', 2);
    const { calls, bodies } = mockServer();
    vi.spyOn(Date, 'now').mockReturnValue(AT_TEN.wall + 20 * 60_000);

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['rounds/advance m1 2']);
    expect(bodies[0]).toEqual({
      clientUuid: row.clientUuid,
      round: 2,
      pressedAt: '2026-10-10T10:00:00.000Z',
      sentAt: '2026-10-10T10:20:00.000Z',
    });
  });

  it('"End round 1" goes to the end door, and its kept score is not sent', async () => {
    const row = await addRound('end', 1);
    await db.outbox.update(row.id as number, { endScore: { red: 3, blue: 2 } });
    const { calls, bodies } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['rounds/end m1 1']);
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual([
      'clientUuid',
      'pressedAt',
      'round',
      'sentAt',
    ]);
  });

  it('says its age again at each send: a second send is older', async () => {
    const row = await addRound('advance', 2);
    const now = (minutes: number) => ({
      wall: AT_TEN.wall + minutes * 60_000,
      page: AT_TEN.page + minutes * 60_000,
      origin: AT_TEN.origin,
    });

    expect(roundPressBody(row, now(5)).sentAt).toBe('2026-10-10T10:05:00.000Z');
    expect(roundPressBody(row, now(45)).sentAt).toBe('2026-10-10T10:45:00.000Z');
    expect(roundPressBody(row, now(45)).pressedAt).toBe('2026-10-10T10:00:00.000Z');
  });

  it('leaves the queue when the server takes it, and nothing is kept of it', async () => {
    await addRound('advance', 2);
    mockServer();
    const { engine, last } = watched();

    await engine.drain();

    expect(await queued()).toEqual([]);
    expect(await db.synced.count()).toBe(0);
    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
  });

  it('tells the screen the server’s answer BEFORE the row leaves the queue', async () => {
    const row = await addRound('advance', 2);
    mockServer();
    const engine = new SyncEngine(API_URL);
    const heard: unknown[] = [];
    let queuedWhenTold: Promise<number> | undefined;
    engine.onPressSent((press, answer) => {
      heard.push({ press, answer });
      queuedWhenTold = db.outbox.count();
    });

    await engine.drain();

    expect(heard).toEqual([
      { press: { matchId: 'm1', clientUuid: row.clientUuid }, answer: { currentRound: 2 } },
    ]);
    expect(await queuedWhenTold).toBe(1);
  });
});

describe('a bout of two rounds sent in its order', () => {
  it('goes hit, "Start round 2", the clock, hit', async () => {
    await twoRounds();
    const { calls } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual([
      'exchanges m1',
      'rounds/advance m1 2',
      'clock m1 resume',
      'exchanges m1',
    ]);
    expect(await queued()).toEqual([]);
  });

  it('a "Start round 2" that could not be sent stops the rows of its bout behind it', async () => {
    await twoRounds();
    const { calls } = mockServer((call) =>
      call.startsWith('rounds/advance') ? { status: 502 } : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls, 'the hit of round 2 was not sent into round 1').toEqual([
      'exchanges m1',
      'rounds/advance m1 2',
    ]);
    expect(await queued()).toEqual(['round advance 2', 'press resume', 'hit']);
    expect(await heldRows(), 'a server fault is no verdict').toEqual([]);
  });

  it('a hit right behind a "Start round 2" that could not be sent waits too, with no clock press between', async () => {
    await addRound('advance', 2);
    await addHit();
    const { calls } = mockServer((call) =>
      call.startsWith('rounds/advance') ? { status: 502 } : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls, 'the hit of round 2 was not sent into round 1').toEqual(['rounds/advance m1 2']);
    expect(await queued()).toEqual(['round advance 2', 'hit']);
  });

  it('a "Start round 2" never passes a hit of round 1 that could not be sent', async () => {
    await addHit();
    await addRound('advance', 2, 'm1', 60);
    const { calls } = mockServer((call) => (call === 'exchanges m1' ? { status: 502 } : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['exchanges m1']);
    expect(await queued()).toEqual(['hit', 'round advance 2']);
  });

  it('with no network every row stays, in its order', async () => {
    await twoRounds();
    mockServer(() => OFFLINE);

    await new SyncEngine(API_URL).drain();

    expect(await queued()).toEqual(['hit', 'round advance 2', 'press resume', 'hit']);
  });
});

describe('a round press the server refuses', () => {
  it.each([
    ['advance', 409, 'round_not_waiting'],
    ['end', 409, 'round_not_open'],
    ['end', 400, 'time_not_finished'],
  ] as const)(
    '"%s" answered %i %s is held at once, with its code',
    async (action, status, code) => {
      const row = await addRound(action, 2);
      const { calls } = mockServer(() => refused(status, code));
      const { engine, last } = watched();

      await engine.drain();

      expect(await queued()).toEqual([]);
      const [held] = await getRejected();
      expect(held).toMatchObject({
        kind: 'round',
        roundAction: action,
        round: 2,
        clientUuid: row.clientUuid,
        rejectedCode: code,
        outboxId: row.id,
      });
      expect(calls, 'one send: no other sequence can cure a round press').toHaveLength(1);
      expect(last()).toMatchObject({ status: 'error', rejectedCount: 1, heldPressCount: 1 });
      expect(await heldPressesOf('m1')).toHaveLength(1);
    },
  );

  it('a 400 reads no list from the server: a round press has no sequence to try again under', async () => {
    await addRound('advance', 2);
    mockServer(() => refused(400, 'round_awaits_advance'));

    await new SyncEngine(API_URL).drain();

    const gets = vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method);
    expect(gets).toHaveLength(0);
  });

  it('stops the rows of its bout behind it, and another bout goes on', async () => {
    await twoRounds('m1');
    await twoRounds('m2');
    const { calls } = mockServer((call) =>
      call === 'rounds/advance m1 2' ? refused(409, 'round_not_waiting') : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual([
      'exchanges m1',
      'rounds/advance m1 2',
      'exchanges m2',
      'rounds/advance m2 2',
      'clock m2 resume',
      'exchanges m2',
    ]);
    expect(await heldRows()).toEqual(['round advance 2']);
    expect(await queued()).toEqual(['press resume', 'hit']);
  });

  it('a Retry puts it back at its place, before the rows that waited behind it', async () => {
    await twoRounds();
    let refuse = true;
    const { calls } = mockServer((call) =>
      refuse && call.startsWith('rounds/advance') ? refused(409, 'round_not_waiting') : undefined,
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    refuse = false;
    expect(await requeueRejected()).toBe(1);
    expect(await queued()).toEqual(['round advance 2', 'press resume', 'hit']);
    const [again] = await db.outbox.orderBy('id').toArray();
    expect(again?.sequence, 'a round press keeps the sequence of a press').toBe(0);
    await engine.drain();

    expect(calls.slice(2)).toEqual(['rounds/advance m1 2', 'clock m1 resume', 'exchanges m1']);
    expect(await queued()).toEqual([]);
  });

  it('a row that collided with another press on the server stays in the queue', async () => {
    await addRound('advance', 2);
    mockServer(() => refused(409, 'clock_row_collided'));

    await new SyncEngine(API_URL).drain();

    expect(await queued()).toEqual(['round advance 2']);
    expect(await heldRows()).toEqual([]);
  });
});

describe('a round press answered "nobody is signed in"', () => {
  it('stays in the queue, and counts as a press that waits', async () => {
    await addRound('advance', 2);
    mockServer(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    const { engine, last } = watched();

    await engine.drain();

    expect(await queued()).toEqual(['round advance 2']);
    expect(await holdsPress()).toBe(true);
    expect(last()).toMatchObject({ status: 'signed-out' });
  });
});
