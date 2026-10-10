import { describe, expect, it } from 'vitest';
import type { ClockState } from '../components/scoreboard-clock';
import type { OutboxEntry } from './db';
import {
  boutStatusOnPad,
  endScoreOf,
  padClock,
  pressesOf,
  resultUnconfirmed,
  tabletResult,
} from './pad-clock';

const at = (clock: string) => `2026-10-10T${clock}.000Z`;
const NONE = new Set<string>();

let nextId = 1;
function press(
  action: OutboxEntry['pressAction'],
  clock: string,
  uuid = `p${nextId}`,
): OutboxEntry {
  return {
    id: nextId++,
    kind: 'press',
    clientUuid: uuid,
    matchId: 'm1',
    sequence: 0,
    occurredAt: at(clock),
    pressAction: action,
    createdAt: Date.parse(at(clock)),
    attempts: 0,
  };
}

const hit = (clock: string): OutboxEntry => ({
  id: nextId++,
  clientUuid: `h${nextId}`,
  matchId: 'm1',
  sequence: 1,
  type: 'clean',
  occurredAt: at(clock),
  createdAt: Date.parse(at(clock)),
  attempts: 0,
});

const server = (state: Partial<ClockState>): ClockState => ({
  matchId: 'm1',
  status: 'idle',
  activeMs: 0,
  runningFrom: null,
  totalActiveMs: 0,
  startedAt: null,
  events: [],
  levelResolutionSteps: 0,
  ...state,
});

describe('pressesOf', () => {
  it('keeps the clock presses, in the order they were made, and no hit', () => {
    const start = press('start', '10:00:00');
    const scored = hit('10:00:05');
    const halt = press('halt', '10:00:04');

    expect(pressesOf([halt, scored, start])).toEqual([start, halt]);
  });
});

describe('padClock', () => {
  it('is the server’s clock when the tablet holds no press', () => {
    const running = server({ status: 'running', runningFrom: at('10:00:00') });

    expect(padClock('m1', running, [], NONE)).toBe(running);
    expect(padClock('m1', null, [], NONE)).toBeNull();
  });

  it('a Start the tablet holds runs the clock from the time of the tap', () => {
    const clock = padClock('m1', server({}), [press('start', '10:00:00')], NONE);

    expect(clock).toMatchObject({
      matchId: 'm1',
      status: 'running',
      activeMs: 0,
      runningFrom: at('10:00:00'),
      startedAt: at('10:00:00'),
    });
  });

  it('a whole bout pressed with no network adds up: Start, Halt, Resume, End', () => {
    const presses = [
      press('start', '10:00:00'),
      press('halt', '10:00:20'),
      press('resume', '10:01:00'),
      press('end', '10:01:15'),
    ];

    expect(padClock('m1', server({}), presses, NONE)).toMatchObject({
      status: 'ended',
      activeMs: 35_000,
      runningFrom: null,
    });
  });

  it('folds the presses over the server’s clock, and keeps its rows and its level steps', () => {
    const halted = server({
      status: 'halted',
      activeMs: 30_000,
      startedAt: at('09:59:00'),
      events: [{ type: 'start', occurredAt: at('09:59:00') }],
      levelResolutionSteps: 1,
    });

    const clock = padClock('m1', halted, [press('resume', '10:00:00')], NONE);

    expect(clock).toMatchObject({
      status: 'running',
      activeMs: 30_000,
      runningFrom: at('10:00:00'),
      startedAt: at('09:59:00'),
      levelResolutionSteps: 1,
    });
    expect(clock?.events).toBe(halted.events);
  });

  it('starts from idle on a bout opened with no network and no copy of its clock', () => {
    expect(padClock('m1', null, [press('start', '10:00:00')], NONE)).toMatchObject({
      status: 'running',
      runningFrom: at('10:00:00'),
    });
  });

  it('does not fold twice a press the server has answered and the queue still lists', () => {
    // The answer says "running since 10:00:01" (the server's time of the Start).
    const answered = server({ status: 'running', runningFrom: at('10:00:01') });
    const start = press('start', '10:00:00', 'start-1');
    const halt = press('halt', '10:00:30', 'halt-1');

    const clock = padClock('m1', answered, [start, halt], new Set(['start-1']));

    expect(clock).toMatchObject({ status: 'halted', activeMs: 29_000 });
  });

  it('is the server’s clock when every press the queue lists was answered', () => {
    const answered = server({ status: 'halted', activeMs: 30_000 });

    expect(
      padClock('m1', answered, [press('halt', '10:00:30', 'halt-1')], new Set(['halt-1'])),
    ).toBe(answered);
  });

  it('a press the clock cannot take changes nothing: the server will hold it', () => {
    const ended = server({ status: 'ended', activeMs: 40_000 });

    expect(padClock('m1', ended, [press('resume', '10:05:00')], NONE)).toMatchObject({
      status: 'ended',
      activeMs: 40_000,
    });
  });

  it('skips a row that names no clock button', () => {
    const broken = { ...press('start', '10:00:00'), pressAction: undefined };

    expect(padClock('m1', server({}), [broken], NONE)).toMatchObject({ status: 'idle' });
  });
});

describe('boutStatusOnPad', () => {
  it.each([
    ['scheduled', 'running', 'running'],
    ['scheduled', 'halted', 'paused'],
    ['running', 'halted', 'paused'],
    ['paused', 'running', 'running'],
    ['paused', 'ended', 'completed'],
    ['scheduled', 'idle', 'scheduled'],
    ['paused', 'idle', 'paused'],
  ] as const)('a bout the server says is %s, with the pad’s clock %s, is %s', (row, clock, is) => {
    expect(boutStatusOnPad(row, clock)).toBe(is);
  });

  it.each(['completed', 'voided'])('a bout the server says is %s stays that', (row) => {
    expect(boutStatusOnPad(row, 'halted')).toBe(row);
    expect(boutStatusOnPad(row, 'running')).toBe(row);
  });
});

describe('a result that is not confirmed (ruling 11)', () => {
  it('is an ended clock on a bout the server’s row does not say is completed', () => {
    // The End is on the tablet, or the server took it and the bout is not read again.
    expect(resultUnconfirmed('running', 'ended')).toBe(true);
    expect(resultUnconfirmed('paused', 'ended')).toBe(true);
    expect(resultUnconfirmed('scheduled', 'ended')).toBe(true);
  });

  it('is confirmed once the server’s row says completed', () => {
    expect(resultUnconfirmed('completed', 'ended')).toBe(false);
  });

  it('is no result at all while the clock is not ended', () => {
    expect(resultUnconfirmed('running', 'halted')).toBe(false);
    expect(resultUnconfirmed('running', 'running')).toBe(false);
    expect(resultUnconfirmed('scheduled', 'idle')).toBe(false);
  });
});

describe('the score of a result that is not confirmed', () => {
  const end = { ...press('end', '10:02:00', 'end-1'), endScore: { red: 2, blue: 1 } };

  it('is the score the End was pressed on, from the End the queue holds', () => {
    expect(endScoreOf([press('start', '10:00:00'), end], null)).toEqual({
      matchId: 'm1',
      red: 2,
      blue: 1,
    });
  });

  it('is still that score once the End has left the queue', () => {
    const seen = endScoreOf([end], null);

    expect(endScoreOf([], seen)).toEqual({ matchId: 'm1', red: 2, blue: 1 });
  });

  it('is the newer End’s, when the first was refused and the official ended again', () => {
    const seen = endScoreOf([end], null);
    const again = { ...press('end', '10:05:00', 'end-2'), endScore: { red: 3, blue: 1 } };

    expect(endScoreOf([again], seen)).toMatchObject({ red: 3, blue: 1 });
  });

  it('is unknown with no End seen: an End with no score is none', () => {
    expect(endScoreOf([press('start', '10:00:00')], null)).toBeNull();
    expect(endScoreOf([press('end', '10:02:00')], null)).toBeNull();
  });

  it('does not move with the score on the screen while the queue goes out', () => {
    // The server took the two red hits: the screen's own sum reads 0-1 for a moment.
    expect(tabletResult({ red: 2, blue: 1 }, { red: 0, blue: 1 })).toEqual({ red: 2, blue: 1 });
  });

  it('falls back to the score on the screen for a result this screen did not see pressed', () => {
    expect(tabletResult(null, { red: 4, blue: 4 })).toEqual({ red: 4, blue: 4 });
  });
});
