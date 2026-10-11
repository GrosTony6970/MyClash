/**
 * The clock on the pad across a round, with no network.
 *
 * Round 1 ran for two minutes. The official taps "End round", then "Start
 * round 2": the clock goes to zero, halted, and round 2 starts with a Resume.
 * The server will do the same when the queue reaches it (`reset_clock`).
 */
import { describe, expect, it } from 'vitest';
import type { ClockState } from '../components/scoreboard-clock';
import type { OutboxEntry, RoundPress } from './db';
import {
  clockAfterRound,
  endScoreOf,
  padClock,
  pressesOf,
  serverClockAfterRound,
} from './pad-clock';

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
const round = (roundAction: RoundPress, n: number, clock: string) =>
  row({ kind: 'round', roundAction, round: n }, clock);

/** The server's clock: round 1 has run since 10:00:00, with one level step taken. */
const running: ClockState = {
  matchId: 'm1',
  status: 'running',
  activeMs: 0,
  runningFrom: at('10:00:00'),
  totalActiveMs: 0,
  startedAt: at('10:00:00'),
  events: [],
  levelResolutionSteps: 1,
};

describe('the presses that move the clock', () => {
  it('are the clock’s own and the round buttons’, in the order they were made, and no hit', () => {
    const end = round('end', 1, '10:02:00');
    const hit = row({ type: 'clean' }, '10:01:00');
    const halt = press('halt', '10:01:30');

    expect(pressesOf([end, hit, halt])).toEqual([end, halt]);
  });
});

describe('"End round" on the pad’s clock', () => {
  it('stops the time that runs, at the time of the tap', () => {
    const clock = padClock('m1', running, [round('end', 1, '10:02:00')], NONE);

    expect(clock).toMatchObject({ status: 'halted', activeMs: 120_000, runningFrom: null });
  });

  it('changes nothing on a clock that is halted already', () => {
    const halted = { ...running, status: 'halted' as const, activeMs: 90_000, runningFrom: null };

    expect(padClock('m1', halted, [round('end', 1, '10:02:00')], NONE)).toMatchObject({
      status: 'halted',
      activeMs: 90_000,
    });
  });

  it('keeps the level steps the round has taken', () => {
    const clock = padClock('m1', running, [round('end', 1, '10:02:00')], NONE);

    expect(clock?.levelResolutionSteps).toBe(1);
  });
});

describe('"Start round 2" on the pad’s clock', () => {
  const rows = [round('end', 1, '10:02:00'), round('advance', 2, '10:03:00')];

  it('puts the round’s time to zero, halted, and the level steps to zero', () => {
    expect(padClock('m1', running, rows, NONE)).toMatchObject({
      status: 'halted',
      activeMs: 0,
      totalActiveMs: 0,
      runningFrom: null,
      levelResolutionSteps: 0,
      // The bout's own start is kept: it is the bout's, not the round's.
      startedAt: at('10:00:00'),
    });
  });

  it('then runs round 2 from its Resume', () => {
    const clock = padClock('m1', running, [...rows, press('resume', '10:03:30')], NONE);

    expect(clock).toMatchObject({ status: 'running', activeMs: 0, runningFrom: at('10:03:30') });
  });

  it('is not folded twice once the server answered it', () => {
    const [end, advance] = rows as [OutboxEntry, OutboxEntry];
    const answered = serverClockAfterRound(
      serverClockAfterRound(running, { action: 'end', at: end.occurredAt }),
      { action: 'advance', at: advance.occurredAt },
    );
    const sent = new Set([end.clientUuid, advance.clientUuid]);

    expect(padClock('m1', answered, rows, sent)).toBe(answered);
  });
});

describe('the server’s clock this screen holds, after a round press the server took', () => {
  it('takes the step the queue showed: "End round" halts it at the tap', () => {
    const after = serverClockAfterRound(running, { action: 'end', at: at('10:02:00') });

    expect(after).toMatchObject({
      matchId: 'm1',
      status: 'halted',
      activeMs: 120_000,
      totalActiveMs: 120_000,
      levelResolutionSteps: 1,
    });
  });

  it('"Start round 2" zeroes it, with its level steps', () => {
    const after = serverClockAfterRound(running, { action: 'advance', at: at('10:03:00') });

    expect(after).toMatchObject({
      status: 'halted',
      activeMs: 0,
      totalActiveMs: 0,
      runningFrom: null,
      levelResolutionSteps: 0,
    });
    expect(after.events).toBe(running.events);
  });
});

describe('clockAfterRound', () => {
  it('ends nothing: a series decided by an "End round" is said by the rounds, not this clock', () => {
    const fold = { status: 'running', activeMs: 0, runningFrom: at('10:00:00'), startedAt: null };

    expect(clockAfterRound(fold as never, 'end', at('10:00:10')).status).toBe('halted');
  });
});

describe('the score an "End round" was pressed on', () => {
  it('is not the score of an End of the bout', () => {
    const endRound = { ...round('end', 1, '10:02:00'), endScore: { red: 3, blue: 1 } };

    expect(endScoreOf(pressesOf([endRound]), null)).toBeNull();
  });
});
