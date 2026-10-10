import { describe, expect, it } from 'vitest';
import {
  CLOCK_ACTIONS_FROM,
  IDLE_CLOCK,
  clockAfterPress,
  clockStep,
  foldClock,
  pressAlreadyTrue,
  type ClockFold,
  type ClockMove,
  type ClockPress,
  type ClockStatus,
} from './clock';

const at = (clock: string) => `2026-04-25T${clock}.000Z`;
const move = (type: ClockMove['type'], clock: string, adjustmentMs?: number): ClockMove => ({
  type,
  occurredAt: at(clock),
  ...(adjustmentMs === undefined ? {} : { adjustmentMs }),
});

describe('foldClock', () => {
  it('is idle with no row', () => {
    expect(foldClock([])).toEqual(IDLE_CLOCK);
  });

  it('runs from the Start, and remembers the first Start', () => {
    expect(foldClock([move('start', '10:00:00')])).toEqual({
      status: 'running',
      activeMs: 0,
      runningFrom: at('10:00:00'),
      startedAt: at('10:00:00'),
    });
  });

  it('adds each run of the clock: Start, Halt, Resume, End', () => {
    const clock = foldClock([
      move('start', '10:00:00'),
      move('halt', '10:00:30'),
      move('resume', '10:01:00'),
      move('end', '10:01:15'),
    ]);

    expect(clock).toEqual({
      status: 'ended',
      activeMs: 45_000,
      runningFrom: null,
      startedAt: at('10:00:00'),
    });
  });

  it('an End on a halted clock adds no time', () => {
    const clock = foldClock([
      move('start', '10:00:00'),
      move('halt', '10:00:30'),
      move('end', '10:05:00'),
    ]);

    expect(clock.activeMs).toBe(30_000);
    expect(clock.status).toBe('ended');
  });

  it('a Reopen puts an ended clock back to halted, with its time', () => {
    const clock = foldClock([
      move('start', '10:00:00'),
      move('end', '10:00:40'),
      move('reopen', '10:02:00'),
    ]);

    expect(clock).toMatchObject({ status: 'halted', activeMs: 40_000, runningFrom: null });
  });

  it('a Reset of the clock clears the time and keeps the first Start', () => {
    const clock = foldClock([
      move('start', '10:00:00'),
      move('halt', '10:00:30'),
      move('reset_clock', '10:01:00'),
    ]);

    expect(clock).toEqual({
      status: 'halted',
      activeMs: 0,
      runningFrom: null,
      startedAt: at('10:00:00'),
    });
  });

  it('a time correction moves the time, never under zero, and keeps a run going', () => {
    const halted = [move('start', '10:00:00'), move('halt', '10:00:30')];

    expect(foldClock([...halted, move('adjust_time', '10:01:00', -10_000)]).activeMs).toBe(20_000);
    expect(foldClock([...halted, move('adjust_time', '10:01:00', -90_000)]).activeMs).toBe(0);
    expect(foldClock([move('start', '10:00:00'), move('adjust_time', '10:00:10', 5_000)])).toEqual({
      status: 'running',
      activeMs: 5_000,
      runningFrom: at('10:00:00'),
      startedAt: at('10:00:00'),
    });
  });

  it('a Reset of the bout puts the clock back to idle, and the next Start is the first', () => {
    const reset = [
      move('start', '10:00:00'),
      move('halt', '10:00:30'),
      move('reset_match', '10:10:00'),
    ];

    expect(foldClock(reset)).toEqual(IDLE_CLOCK);
    expect(foldClock([...reset, move('start', '10:20:00')]).startedAt).toBe(at('10:20:00'));
  });

  it('keeps the row’s own string for the time it runs from', () => {
    const raw = '2026-04-25T10:00:00+00:00';

    expect(foldClock([{ type: 'start', occurredAt: raw }]).runningFrom).toBe(raw);
  });

  it('replays a saved row without asking whether it was legal', () => {
    // A Halt on an idle clock: no write lets it through, and a saved one is replayed.
    expect(foldClock([move('halt', '10:00:00')])).toMatchObject({ status: 'halted', activeMs: 0 });
  });
});

describe('clockStep', () => {
  it('does not change the clock it is given', () => {
    const before: ClockFold = { ...IDLE_CLOCK };

    clockStep(before, move('start', '10:00:00'));

    expect(before).toEqual(IDLE_CLOCK);
  });

  it('a row of a type it does not know leaves the clock as it is, and the fold goes on', () => {
    // The rows come from a database: the old fold on the server ignored such a row.
    const stray = { type: 'level_resolution', occurredAt: at('10:00:10') } as unknown as ClockMove;

    const clock = foldClock([move('start', '10:00:00'), stray, move('halt', '10:00:30')]);

    expect(clock).toMatchObject({ status: 'halted', activeMs: 30_000 });
  });
});

describe('the idle clock is one object for every caller', () => {
  it('cannot be changed', () => {
    expect(Object.isFrozen(IDLE_CLOCK)).toBe(true);
  });

  it('is handed out as a copy: by an empty fold, and by a Reset of the bout', () => {
    expect(foldClock([])).not.toBe(IDLE_CLOCK);
    expect(clockStep(foldClock([]), move('reset_match', '10:00:00'))).not.toBe(IDLE_CLOCK);

    const mine = foldClock([]);
    mine.activeMs = 99;
    expect(foldClock([]).activeMs).toBe(0);
  });
});

describe('a press or a state the tables do not know', () => {
  // A stored row can hold anything. `constructor` is on every object.
  const odd = (word: string) => word as never;

  it.each(['constructor', 'toString', 'reopen', ''])('a "%s" is never already true', (word) => {
    expect(pressAlreadyTrue(odd(word), 'running')).toBe(false);
  });

  it.each(['constructor', 'toString', ''])(
    'a "%s" press leaves the pad’s clock as it is',
    (word) => {
      const running = foldClock([move('start', '10:00:00')]);

      expect(clockAfterPress(running, odd(word), at('10:00:30'))).toBe(running);
    },
  );

  it('a clock in a state the tables do not know takes no press', () => {
    const odd: ClockFold = { ...IDLE_CLOCK, status: 'constructor' as never };

    expect(clockAfterPress(odd, 'start', at('10:00:00'))).toBe(odd);
  });
});

describe('what a person may press', () => {
  it('names the presses of each state', () => {
    expect(CLOCK_ACTIONS_FROM).toEqual({
      idle: ['start'],
      running: ['halt', 'end'],
      halted: ['resume', 'end', 'reset_clock'],
      ended: ['reopen'],
    });
  });
});

describe('a press that asks for the state the clock is in (ruling 12)', () => {
  const TRUE: Array<[ClockPress, ClockStatus]> = [
    ['start', 'running'],
    ['start', 'halted'],
    ['halt', 'halted'],
    ['halt', 'ended'],
    ['resume', 'running'],
    ['end', 'ended'],
  ];
  const STATES: ClockStatus[] = ['idle', 'running', 'halted', 'ended'];
  const PRESSES: ClockPress[] = ['start', 'halt', 'resume', 'end'];

  it.each(PRESSES.flatMap((press) => STATES.map((status) => [press, status] as const)))(
    'a %s on a clock that is %s',
    (press, status) => {
      const expected = TRUE.some(([p, s]) => p === press && s === status);

      expect(pressAlreadyTrue(press, status)).toBe(expected);
    },
  );
});

describe('clockAfterPress: the pad’s clock, a press at a time', () => {
  const running = foldClock([move('start', '10:00:00')]);
  const halted = foldClock([move('start', '10:00:00'), move('halt', '10:00:30')]);
  const ended = foldClock([move('start', '10:00:00'), move('end', '10:00:40')]);

  it('applies a press that fits', () => {
    expect(clockAfterPress(IDLE_CLOCK, 'start', at('10:00:00'))).toEqual(running);
    expect(clockAfterPress(running, 'halt', at('10:00:30'))).toEqual(halted);
    expect(clockAfterPress(halted, 'resume', at('10:01:00'))).toMatchObject({
      status: 'running',
      activeMs: 30_000,
      runningFrom: at('10:01:00'),
    });
    expect(clockAfterPress(running, 'end', at('10:00:40'))).toEqual(ended);
  });

  it('leaves the clock as it is for a press that is already true', () => {
    // The server took this Start, and the queue still shows it for a moment.
    expect(clockAfterPress(running, 'start', at('10:00:05'))).toBe(running);
    expect(clockAfterPress(halted, 'halt', at('10:00:45'))).toBe(halted);
    expect(clockAfterPress(ended, 'end', at('10:00:50'))).toBe(ended);
  });

  it('leaves the clock as it is for a press that fits nothing', () => {
    expect(clockAfterPress(IDLE_CLOCK, 'halt', at('10:00:00'))).toBe(IDLE_CLOCK);
    expect(clockAfterPress(IDLE_CLOCK, 'end', at('10:00:00'))).toBe(IDLE_CLOCK);
    expect(clockAfterPress(ended, 'resume', at('10:01:00'))).toBe(ended);
    expect(clockAfterPress(ended, 'start', at('10:01:00'))).toBe(ended);
  });

  it('folds a whole bout pressed with no network: Start, Halt, Resume, Halt, End', () => {
    const presses: Array<[ClockPress, string]> = [
      ['start', '10:00:00'],
      ['halt', '10:00:20'],
      ['resume', '10:00:50'],
      ['halt', '10:01:10'],
      ['end', '10:02:00'],
    ];

    const clock = presses.reduce(
      (now, [press, time]) => clockAfterPress(now, press, at(time)),
      IDLE_CLOCK,
    );

    expect(clock).toEqual({
      status: 'ended',
      activeMs: 40_000,
      runningFrom: null,
      startedAt: at('10:00:00'),
    });
  });
});
