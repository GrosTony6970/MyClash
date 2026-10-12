/**
 * A level bout with no wifi: 2 - 2 at the end of its time. The official taps
 * "Extra time 60s", fights the minute, taps "Sudden death", scores and ends
 * the bout. The step of a level bout is a row of the tablet's queue (the
 * offline bout, slice 5), so the server gets the bout in the order it happened.
 *
 * A step is a tap, not an entry: it takes no number of the bout's sequence,
 * nothing of its bout may pass it, and it goes to its own door.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { undoLastEntry } from '../lib/clear-last';
import { db, isTap, kindOf } from './db';
import { nextSequence } from './outbox';
import { pendingRowsForMatch } from './pending-events';
import { getAllPending } from './outbox';
import { heldPressesOf, holdsPress } from './press-queue';
import { levelPressBody } from './press-send';
import { SyncEngine } from './sync';
import {
  API_URL,
  AT_TEN,
  BOUT,
  EXTRA_TIME,
  OFFLINE,
  SUDDEN_DEATH,
  addHit,
  addLevel,
  addPress,
  clearStore,
  heldRows,
  mockServer,
  queued,
  refused,
} from './sync.press.fixtures';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';

beforeEach(async () => {
  await clearStore();
  await Promise.all([db.reads.clear(), db.undone.clear()]);
});

/** The level bout: a hit, the minute of extra time, sudden death, the deciding hit, the End. */
async function levelBout(matchId = 'm1') {
  await addHit(matchId);
  await addLevel(EXTRA_TIME, matchId, 90);
  await addPress('resume', matchId, 100);
  await addPress('halt', matchId, 160);
  await addLevel(SUDDEN_DEATH, matchId, 170);
  await addHit(matchId);
  await addPress('end', matchId, 200);
}

describe('a step of a level bout written on the tablet', () => {
  it('is a row of the queue with its step, its round, its bout and the tablet’s two clocks', async () => {
    const row = await addLevel(EXTRA_TIME, 'm1', 0, 2);

    expect(await db.outbox.get(row.id as number)).toMatchObject({
      kind: 'level',
      level: { step: 0, kind: 'extra_time', seconds: 60, limitMs: 90_000 },
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

  it('is its own kind, and a tap as a clock press is', () => {
    expect(kindOf({ kind: 'level' })).toBe('level');
    expect(isTap({ kind: 'level' })).toBe(true);
  });

  it('takes no number of the bout’s sequence, and is a press the tablet holds', async () => {
    await addHit();
    const before = await nextSequence('m1');

    const row = await addLevel();

    expect(row.sequence).toBe(0);
    expect(await nextSequence('m1')).toBe(before);
    expect(await holdsPress()).toBe(true);
  });

  it('draws no line in the bout’s list', async () => {
    await addHit('m1', 'hit-1');
    await addLevel(EXTRA_TIME, 'm1', 90);

    const rows = pendingRowsForMatch({
      entries: await getAllPending(),
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [],
    });

    expect(rows.exchanges.map((row) => row.client_uuid)).toEqual(['hit-1']);
    expect(rows.penalties).toEqual([]);
  });
});

describe('the send of a step of a level bout', () => {
  it('goes to its door with its id, its round, its place in the chain and its two times', async () => {
    const row = await addLevel(SUDDEN_DEATH, 'm1', 0, 2);
    const { calls, bodies } = mockServer();
    vi.spyOn(Date, 'now').mockReturnValue(AT_TEN.wall + 20 * 60_000);

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['level m1 1']);
    // What the step is, and the time it gives, stay on the tablet: the server
    // works them out, and its strict schema refuses a sixth key.
    expect(bodies[0]).toEqual({
      clientUuid: row.clientUuid,
      round: 2,
      step: 1,
      pressedAt: '2026-10-10T10:00:00.000Z',
      sentAt: '2026-10-10T10:20:00.000Z',
    });
  });

  it('sends step 0, the first of a round: a zero is not "no step"', async () => {
    await addLevel(EXTRA_TIME);
    const { bodies } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(bodies[0]).toMatchObject({ step: 0, round: 1 });
  });

  it('says its age again at each send: a second send is older', async () => {
    const row = await addLevel();
    const now = (minutes: number) => ({
      wall: AT_TEN.wall + minutes * 60_000,
      page: AT_TEN.page + minutes * 60_000,
      origin: AT_TEN.origin,
    });

    expect(levelPressBody(row, now(5)).sentAt).toBe('2026-10-10T10:05:00.000Z');
    expect(levelPressBody(row, now(45)).sentAt).toBe('2026-10-10T10:45:00.000Z');
    expect(levelPressBody(row, now(45)).pressedAt).toBe('2026-10-10T10:00:00.000Z');
  });

  it('tells the screen the server’s clock BEFORE the row leaves the queue, and keeps nothing of it', async () => {
    const row = await addLevel();
    mockServer();
    const engine = new SyncEngine(API_URL);
    const heard: unknown[] = [];
    let queuedWhenTold: Promise<number> | undefined;
    engine.onPressSent((press, answer) => {
      heard.push({ press, answer });
      queuedWhenTold = db.outbox.count();
    });

    await engine.drain();

    // The answer is a clock, as of a clock press: the screen takes it whole.
    expect(heard).toEqual([
      {
        press: { matchId: 'm1', clientUuid: row.clientUuid },
        answer: { status: 'halted', matchId: 'm1', levelResolutionSteps: 1 },
      },
    ]);
    expect(await queuedWhenTold).toBe(1);
    expect(await queued()).toEqual([]);
    expect(await db.synced.count()).toBe(0);
  });
});

describe('a level bout sent in its order', () => {
  it('goes hit, extra time, the clock, sudden death, hit, End', async () => {
    await levelBout();
    const { calls } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual([
      'exchanges m1',
      'level m1 0',
      'clock m1 resume',
      'clock m1 halt',
      'level m1 1',
      'exchanges m1',
      'clock m1 end',
    ]);
    expect(await queued()).toEqual([]);
  });

  it('a step that could not be sent stops the rows of its bout behind it', async () => {
    await addLevel(SUDDEN_DEATH);
    await addHit();
    const { calls } = mockServer((call) =>
      call.startsWith('level') ? { status: 502 } : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls, 'the hit of sudden death was not sent before the step').toEqual(['level m1 1']);
    expect(await queued()).toEqual(['level sudden_death 1', 'hit']);
    expect(await heldRows(), 'a server fault is no verdict').toEqual([]);
  });

  it('a step never passes a hit of its bout that could not be sent', async () => {
    await addHit();
    await addLevel(EXTRA_TIME, 'm1', 90);
    const { calls } = mockServer((call) => (call === 'exchanges m1' ? { status: 502 } : undefined));

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['exchanges m1']);
    expect(await queued()).toEqual(['hit', 'level extra_time 0']);
  });

  it('with no network every row stays, in its order', async () => {
    await levelBout();
    mockServer(() => OFFLINE);

    await new SyncEngine(API_URL).drain();

    expect(await queued()).toEqual([
      'hit',
      'level extra_time 0',
      'press resume',
      'press halt',
      'level sudden_death 1',
      'hit',
      'press end',
    ]);
  });
});

describe('a step the server refuses', () => {
  it.each([
    [400, 'bout_not_level'],
    [400, 'level_step_not_pending'],
    [400, 'time_not_finished'],
    [409, 'round_not_open'],
    [409, 'pressed_before_reopen'],
  ] as const)('answered %i %s is held at once, with its code', async (status, code) => {
    const row = await addLevel();
    const { calls } = mockServer(() => refused(status, code));

    await new SyncEngine(API_URL).drain();

    expect(calls, 'no second try under another sequence: a step has none').toEqual(['level m1 0']);
    expect(await queued()).toEqual([]);
    const [held] = await heldPressesOf('m1');
    expect(held).toMatchObject({
      clientUuid: row.clientUuid,
      kind: 'level',
      level: EXTRA_TIME,
      rejectedCode: code,
    });
  });

  it('holds the rows of its bout behind it; another bout goes on', async () => {
    await addLevel();
    await addHit('m1');
    await addHit('m2');
    const { calls } = mockServer((call) =>
      call.startsWith('level') ? refused(400, 'bout_not_level') : undefined,
    );

    await new SyncEngine(API_URL).drain();

    expect(calls).toEqual(['level m1 0', 'exchanges m2']);
    expect(await queued()).toEqual(['hit']);
    expect(await heldRows()).toEqual(['level extra_time 0']);
  });
});

describe('the undo, with a step of a level bout in the queue', () => {
  const undo = (takeBack: Parameters<typeof undoLastEntry>[0]['takeBack']) =>
    undoLastEntry({ apiUrl: API_URL, matchId: 'm1', t: (key) => key, takeBack });

  it('stops at the step: a hit before it made the board level, and is not taken back', async () => {
    await addHit('m1', 'hit-1');
    await addLevel(EXTRA_TIME, 'm1', 90);
    const fetched = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetched);
    const takeBack = vi.fn();

    expect(await undo(takeBack)).toEqual({
      kind: 'failed',
      message: 'scoring.level.undoStopsAtStep',
    });

    expect(takeBack).not.toHaveBeenCalled();
    expect(fetched, 'the server is asked for nothing').not.toHaveBeenCalled();
    expect(await queued()).toEqual(['hit', 'level extra_time 0']);
  });

  it('takes back a hit of sudden death, behind the step', async () => {
    await addLevel(SUDDEN_DEATH);
    await addHit('m1', 'hit-2');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const taken: string[] = [];

    const outcome = await undo(async (entry) => {
      taken.push(entry.clientUuid);
      await db.outbox.delete(entry.id as number);
      return { kind: 'removed' };
    });

    expect(outcome).toEqual({ kind: 'voided', entry: { clientUuid: 'hit-2' } });
    expect(taken).toEqual(['hit-2']);
    expect(await queued()).toEqual(['level sudden_death 1']);
  });
});
