/**
 * The clock on the pad across the steps of a level bout, with no network.
 *
 * A bracket bout of 90 seconds, level at the end of its time. "Extra time 60s"
 * pauses the clock and puts a minute on it; "Sudden death" counts a second step
 * and leaves the time. The server does the same when the queue reaches it
 * (`level-step.ts` there).
 */
import { describe, expect, it } from 'vitest';
import type { ClockFold } from '@myclash/types';
import type { ClockState } from '../components/scoreboard-clock';
import type { LevelPress, OutboxEntry } from './db';
import { clockAfterLevel, levelPressOf, padClock, pressesOf } from './pad-clock';

const at = (clock: string) => `2026-10-10T${clock}.000Z`;
const NONE = new Set<string>();

let nextId = 1;
const row = (over: Partial<OutboxEntry>, clock: string): OutboxEntry => ({
  id: nextId++,
  clientUuid: `row-${nextId}`,
  matchId: 'm1',
  sequence: 0,
  occurredAt: at(clock),
  createdAt: Date.parse(at(clock)),
  attempts: 0,
  ...over,
});
const press = (pressAction: OutboxEntry['pressAction'], clock: string) =>
  row({ kind: 'press', pressAction }, clock);
const level = (step: LevelPress, clock: string) => row({ kind: 'level', level: step }, clock);

const EXTRA: LevelPress = { step: 0, kind: 'extra_time', seconds: 60, limitMs: 90_000 };
const SUDDEN: LevelPress = { step: 1, kind: 'sudden_death' };

/** The server's clock: paused at the end of the 90 seconds, no step taken. */
const spent: ClockState = {
  matchId: 'm1',
  status: 'halted',
  activeMs: 90_000,
  runningFrom: null,
  totalActiveMs: 90_000,
  startedAt: at('10:00:00'),
  events: [],
  levelResolutionSteps: 0,
};
/** The same bout, with a clock nobody paused. */
const runs: ClockState = { ...spent, status: 'running', activeMs: 0, runningFrom: at('10:00:00') };

describe('the row of the step a level bout waits for', () => {
  it('is extra time, with its seconds and the phase’s limit the fold gives them against', () => {
    expect(levelPressOf({ kind: 'extra_time', seconds: 60 }, 0, 90)).toEqual(EXTRA);
  });

  it('says so when the phase has no limit: there is nothing to extend', () => {
    const step = levelPressOf({ kind: 'extra_time', seconds: 60 }, 0, null);

    expect(step).toEqual({ step: 0, kind: 'extra_time', seconds: 60, limitMs: null });
  });

  it('is sudden death at its own place in the chain, with no time', () => {
    expect(levelPressOf({ kind: 'sudden_death' }, 1, 90)).toEqual(SUDDEN);
  });

  it('is none for a chain that is spent, and for a chain that ends in a draw', () => {
    expect(levelPressOf(null, 2, 90)).toBeNull();
    expect(levelPressOf({ kind: 'draw' }, 0, 90)).toBeNull();
  });
});

describe('the clock after a step', () => {
  const halted: ClockFold = {
    status: 'halted',
    activeMs: 90_000,
    runningFrom: null,
    startedAt: null,
  };

  it('extra time puts its seconds on the clock: the limit less the seconds given, paused', () => {
    expect(clockAfterLevel(halted, EXTRA, at('10:01:40'))).toEqual({ ...halted, activeMs: 30_000 });
  });

  it('gives exactly the seconds on a clock that ran past its limit', () => {
    const past = { ...halted, activeMs: 150_000 };

    expect(clockAfterLevel(past, EXTRA, at('10:02:40')).activeMs).toBe(30_000);
  });

  it('never goes under zero: extra time longer than the limit', () => {
    const long: LevelPress = { ...EXTRA, seconds: 120 };

    expect(clockAfterLevel(halted, long, at('10:01:40')).activeMs).toBe(0);
  });

  it('leaves the time as it is in a phase with no limit', () => {
    const noLimit: LevelPress = { ...EXTRA, limitMs: null };

    expect(clockAfterLevel(halted, noLimit, at('10:01:40'))).toEqual(halted);
  });

  it('pauses a clock that runs, at the tap, before the time is given', () => {
    const running: ClockFold = {
      ...halted,
      status: 'running',
      activeMs: 0,
      runningFrom: at('10:00:00'),
    };

    expect(clockAfterLevel(running, EXTRA, at('10:01:40'))).toEqual({
      status: 'halted',
      activeMs: 30_000,
      runningFrom: null,
      startedAt: null,
    });
  });

  it('sudden death pauses a clock that runs and leaves its time', () => {
    const running: ClockFold = {
      ...halted,
      status: 'running',
      activeMs: 0,
      runningFrom: at('10:00:00'),
    };

    expect(clockAfterLevel(running, SUDDEN, at('10:01:40'))).toMatchObject({
      status: 'halted',
      activeMs: 100_000,
    });
    expect(clockAfterLevel(halted, SUDDEN, at('10:01:40'))).toEqual(halted);
  });
});

describe('the clock on the pad with a step in the queue', () => {
  it('is a press that moves the clock', () => {
    const step = level(EXTRA, '10:01:40');
    const hit = row({ type: 'clean' }, '10:01:00');

    expect(pressesOf([step, hit])).toEqual([step]);
  });

  it('"Extra time 60s": one step taken, a minute on the clock, paused', () => {
    const clock = padClock('m1', spent, [level(EXTRA, '10:01:40')], NONE);

    expect(clock).toMatchObject({
      status: 'halted',
      activeMs: 30_000,
      runningFrom: null,
      levelResolutionSteps: 1,
    });
  });

  it('tapped while the clock runs: paused with the minute on it', () => {
    const clock = padClock('m1', runs, [level(EXTRA, '10:01:40')], NONE);

    expect(clock).toMatchObject({ status: 'halted', activeMs: 30_000, levelResolutionSteps: 1 });
  });

  it('the whole chain: the minute is fought from the Resume, then sudden death keeps the time', () => {
    const clock = padClock(
      'm1',
      spent,
      [
        level(EXTRA, '10:01:40'),
        press('resume', '10:02:00'),
        press('halt', '10:03:00'),
        level(SUDDEN, '10:03:10'),
      ],
      NONE,
    );

    expect(clock).toMatchObject({ status: 'halted', activeMs: 90_000, levelResolutionSteps: 2 });
  });

  it('a step the server has answered is not folded twice', () => {
    const step = level(EXTRA, '10:01:40');
    const answered: ClockState = { ...spent, activeMs: 30_000, levelResolutionSteps: 1 };

    const clock = padClock(
      'm1',
      answered,
      [step, press('resume', '10:02:00')],
      new Set([step.clientUuid]),
    );

    expect(clock).toMatchObject({ status: 'running', activeMs: 30_000, levelResolutionSteps: 1 });
  });

  it('counts the step with no clock of the server: a bout opened with no network', () => {
    const clock = padClock('m1', null, [level(SUDDEN, '10:03:10')], NONE);

    expect(clock?.levelResolutionSteps).toBe(2);
  });

  it('a step that waits behind a HELD one does not count the held one: the server never took it', () => {
    // "Extra time" was refused and is in the inbox, so it is not in these rows.
    // "Sudden death" (the second step) waits behind it; the server's count is 0.
    const clock = padClock('m1', spent, [level(SUDDEN, '10:03:10')], NONE);

    expect(clock?.levelResolutionSteps).toBe(1);
  });
});
