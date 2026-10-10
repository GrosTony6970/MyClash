import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  ENDED,
  HALTED,
  IDLE,
  NOW,
  PRESS,
  RUNNING,
  press,
  refusalOf,
  row,
  setup,
  wroteNothing,
} from './clock-late-press.fixtures';

/** The fixtures say the story: a tablet's queue of clock presses reaches the server at 11:00. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a press the server holds', () => {
  const SAVED = [...ENDED.slice(0, 2), row(3, 'end', '10:00:40', { client_uuid: PRESS })];

  it('is answered with the clock, and writes nothing', async () => {
    const { db, clock } = setup(SAVED, { status: 'completed' });

    const answer = await clock.latePress(BOUT, 'end', press('10:00:40'));

    expect(answer).toMatchObject({ matchId: BOUT, status: 'ended', activeMs: 30_000 });
    wroteNothing(db);
    expect(filtersFor(db.from, 'match_events', 'eq')).toContainEqual(['client_uuid', PRESS]);
  });

  it('is answered before every rule: a locked bout of an over Event', async () => {
    const { db, clock } = setup(SAVED, { status: 'completed', locked_at: NOW }, 'archived');

    await expect(clock.latePress(BOUT, 'end', press('10:00:40'))).resolves.toMatchObject({
      status: 'ended',
    });
    wroteNothing(db);
  });
});

describe('a press for a bout of an over Event', () => {
  it.each(['completed', 'archived'])('is refused as a new hit is (%s)', async (status) => {
    const { db, clock } = setup(HALTED, {}, status);

    expect(await refusalOf(clock.latePress(BOUT, 'resume', press('10:05:00')))).toEqual({
      status: 409,
      code: 'event_results_frozen',
    });
    wroteNothing(db);
  });

  it('is refused before it is "already true": an End on an ended clock', async () => {
    const { db, clock } = setup(ENDED, { status: 'completed' }, 'completed');

    expect((await refusalOf(clock.latePress(BOUT, 'end', press('10:05:00')))).code).toBe(
      'event_results_frozen',
    );
    wroteNothing(db);
  });

  it('reads the Event’s status with the bout', async () => {
    const { db, clock } = setup(HALTED);

    await clock.latePress(BOUT, 'resume', press('10:05:00'));

    // The double ignores the projection: without this the column can leave the read.
    expect(selectsFor(db.from, 'matches')[0]).toContain('events(status)');
  });

  it('is an error when the read does not say the Event’s status', async () => {
    const { db, clock } = setup(HALTED, { phases: { type: 'pool', tournaments: {} } });

    await expect(clock.latePress(BOUT, 'resume', press('10:05:00'))).rejects.toThrow(
      'Could not read the Event of bout m1',
    );
    wroteNothing(db);
  });
});

describe('a press that asks for the state the clock is in (ruling 12)', () => {
  it.each([
    ['start', 'running', RUNNING],
    ['start', 'halted', HALTED],
    ['halt', 'halted', HALTED],
    ['halt', 'ended', ENDED],
    ['resume', 'running', RUNNING],
    ['end', 'ended', ENDED],
  ] as const)(
    'a %s on a clock that is %s is done, and writes nothing',
    async (action, _, events) => {
      const { db, clock, completion } = setup(events);

      const answer = await clock.latePress(BOUT, action, press('10:00:50'));

      expect(answer.status).toBe(_);
      wroteNothing(db);
      expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    },
  );

  it('is done on a completed and locked bout too: the cap ended the clock first', async () => {
    const { db, clock } = setup(ENDED, { status: 'completed', locked_at: NOW });

    await expect(clock.latePress(BOUT, 'end', press('10:00:50'))).resolves.toMatchObject({
      status: 'ended',
    });
    await expect(
      clock.latePress(BOUT, 'halt', press('10:00:35', 0, 'other')),
    ).resolves.toBeTruthy();
    wroteNothing(db);
  });
});

describe('a press that would put a completed bout back in play', () => {
  it.each([
    ['start', IDLE],
    ['resume', HALTED],
    ['halt', RUNNING],
  ] as const)('a %s is refused, and nothing is undone', async (action, events) => {
    const { db, clock, completion } = setup(events, { status: 'completed' });

    expect(await refusalOf(clock.latePress(BOUT, action, press('10:05:00')))).toEqual({
      status: 409,
      code: 'bout_completed',
    });
    wroteNothing(db);
    expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
  });

  it('an End still ends the clock of a bout a forfeit completed', async () => {
    const { db, clock, completion } = setup(HALTED, { status: 'completed' });

    await clock.latePress(BOUT, 'end', press('10:05:00'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ type: 'end' });
    // The forfeit's result stays: the End names no winner and no reason.
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'completed',
      ended_at: '2026-04-25T10:05:00.000Z',
      duration_active_ms: 30_000,
      duration_total_ms: 300_000,
    });
    expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
  });
});

describe('a press from before the bout’s last reset', () => {
  const RESET = [...HALTED, row(3, 'reset_match', '10:30:00')];

  it('is refused as a hit from before it is', async () => {
    const { db, clock } = setup(RESET, { status: 'scheduled' });

    expect(await refusalOf(clock.latePress(BOUT, 'start', press('10:20:00')))).toEqual({
      status: 409,
      code: 'scored_before_reset',
    });
    wroteNothing(db);
  });

  it('is judged on how old it is, not on the tablet’s time of day', async () => {
    // Pressed at 10:40, after the reset. This tablet's clock says 09:40.
    const late = setup(RESET, { status: 'scheduled' });
    await late.clock.latePress(BOUT, 'start', press('10:40:00', -60));
    expect(writesTo(late.db, 'match_events')).toHaveLength(1);

    // Pressed at 10:20, before the reset. This tablet's clock says 11:20.
    const early = setup(RESET, { status: 'scheduled' });
    expect(
      (await refusalOf(early.clock.latePress(BOUT, 'start', press('10:20:00', 60)))).code,
    ).toBe('scored_before_reset');
  });
});

describe('the rules of every press', () => {
  it('a locked bout refuses it', async () => {
    const { db, clock } = setup(HALTED, { locked_at: NOW });

    expect((await refusalOf(clock.latePress(BOUT, 'resume', press('10:05:00')))).code).toBe(
      'match_locked',
    );
    wroteNothing(db);
  });

  it('whoever may pass the lock passes it', async () => {
    const { db, clock } = setup(HALTED, { locked_at: NOW });

    await clock.latePress(BOUT, 'resume', press('10:05:00'), { canOverrideLocked: true });

    expect(writesTo(db, 'match_events')).toHaveLength(1);
  });

  it.each([
    ['halt', IDLE],
    ['resume', IDLE],
    ['end', IDLE],
    ['start', ENDED],
    ['resume', ENDED],
  ] as const)('a %s that fits nothing is refused with a code (%#)', async (action, events) => {
    const { db, clock } = setup(events);

    expect(await refusalOf(clock.latePress(BOUT, action, press('10:05:00')))).toEqual({
      status: 409,
      code: 'clock_press_out_of_order',
    });
    wroteNothing(db);
  });

  it('a Start between two rounds is refused', async () => {
    const { db, clock } = setup(IDLE, { awaiting_round_advance: true });

    expect((await refusalOf(clock.latePress(BOUT, 'start', press('10:05:00')))).code).toBe(
      'round_awaits_advance',
    );
    wroteNothing(db);
  });

  it('a Resume between two rounds is refused', async () => {
    const { db, clock } = setup(HALTED, { awaiting_round_advance: true });

    expect((await refusalOf(clock.latePress(BOUT, 'resume', press('10:05:00')))).code).toBe(
      'round_awaits_advance',
    );
    wroteNothing(db);
  });

  it('an unknown bout is not found', async () => {
    const { clock } = setup(IDLE);

    await expect(clock.latePress('m2', 'start', press('10:05:00'))).rejects.toThrow(
      'Match m2 not found',
    );
  });
});
