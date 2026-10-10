import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  supabaseChain,
  writesTo,
} from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import {
  BOUT,
  HALTED,
  IDLE,
  NOW,
  PRESS,
  RUNNING,
  at,
  collide,
  press,
  refusalOf,
  row,
  setup,
  wroteNothing,
} from './clock-late-press.fixtures';
import { latePressOf } from './late-press';

/** The fixtures say the story: a tablet's queue of clock presses reaches the server at 11:00. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('where a late press is placed', () => {
  it.each([
    ['whose clock is right', 0],
    ['whose clock is an hour ahead', 60],
    ['whose clock is an hour behind', -60],
  ])('a Start of 30 minutes ago is written 30 minutes ago, on a tablet %s', async (_, skew) => {
    const { db, clock } = setup(IDLE, { status: 'scheduled', started_at: null });

    await clock.latePress(BOUT, 'start', press('10:30:00', skew), { staffAccountId: 'staff-1' });

    expect(writesTo(db, 'match_events')).toEqual([
      expect.objectContaining({
        op: 'insert',
        row: {
          match_id: BOUT,
          sequence: 1,
          type: 'start',
          reason: null,
          by_user_id: null,
          staff_account_id: 'staff-1',
          occurred_at: at('10:30:00'),
          client_uuid: PRESS,
        },
      }),
    ]);
    const [update] = writesTo(db, 'matches');
    expect(update?.row).toEqual({ status: 'running', started_at: at('10:30:00') });
    expect(update?.filters).toContainEqual({ method: 'eq', args: ['id', BOUT] });
  });

  it('is never before the row the bout ends with', async () => {
    // Somebody halted the clock at 10:45 from another tablet. This Resume was
    // pressed at 10:40: placed there, it would re-sort the bout's history.
    const { db, clock } = setup([...RUNNING, row(2, 'halt', '10:45:00')]);

    await clock.latePress(BOUT, 'resume', press('10:40:00'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 3,
      occurred_at: at('10:45:00'),
    });
  });

  it('reads the row the timeline ends with, not the highest sequence', async () => {
    const { db, clock } = setup([...RUNNING, row(2, 'halt', '10:45:00')]);

    await clock.latePress(BOUT, 'resume', press('10:40:00'));

    expect(filtersFor(db.from, 'match_events', 'order')).toContainEqual([
      'occurred_at',
      { ascending: false },
    ]);
  });

  it('a send dated before its press is a press of now', async () => {
    const { db, clock } = setup(HALTED);
    const backwards = { clientUuid: PRESS, pressedAt: at('10:50:00'), sentAt: at('10:10:00') };

    await clock.latePress(BOUT, 'resume', backwards);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: NOW });
  });
});

describe('a late End', () => {
  it('ends the bout at the time it was pressed, with the time the clock had run', async () => {
    // The clock runs since 10:00. The End was pressed at 10:01:30, the 90
    // seconds of a pool bout, and reaches the server at 11:00.
    const { db, clock, completion } = setup(RUNNING);

    await clock.latePress(BOUT, 'end', press('10:01:30'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'end',
      occurred_at: at('10:01:30'),
      client_uuid: PRESS,
    });
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'completed',
      ended_at: at('10:01:30'),
      duration_active_ms: 90_000,
      duration_total_ms: 90_000,
      winner_registration_id: 'red',
      end_reason: 'time_limit',
    });
    expect(completion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
  });

  it('is judged on the time the clock had run when it was pressed', async () => {
    // A level bout, ended 30 seconds in. An hour later the clock "has run" an
    // hour: read then, the time would be finished and the End taken.
    const { db, clock } = setup(RUNNING, { red_score: 2, blue_score: 2 });

    expect((await refusalOf(clock.latePress(BOUT, 'end', press('10:00:30')))).code).toBe(
      'time_not_finished',
    );
    wroteNothing(db);
  });

  it('counts the interval that still runs: a level pool bout at its time is a draw', async () => {
    const { db, clock } = setup(RUNNING, { red_score: 2, blue_score: 2 });

    await clock.latePress(BOUT, 'end', press('10:01:30'));

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      status: 'completed',
      duration_active_ms: 90_000,
    });
  });
});

describe('a read that fails', () => {
  const TIMEOUT = { data: null, error: { message: 'timeout' } };

  it('of the saved presses is an error, never "not saved"', async () => {
    const db = mockSupabase({ match_events: TIMEOUT });
    const clock = new ClockService(db as never);

    await expect(clock.latePress(BOUT, 'start', press('10:05:00'))).rejects.toThrow(
      'Could not read a clock press: timeout',
    );
    wroteNothing(db);
  });

  it('of the timeline’s last row is an error, never "an empty timeline"', async () => {
    const { db, clock } = setup(HALTED);
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      const order = chain.order;
      chain.order = vi.fn((column: string, how: { ascending: boolean }) =>
        column === 'occurred_at' && !how.ascending ? supabaseChain(TIMEOUT) : order(column, how),
      ) as never;
      return chain;
    }) as never;

    await expect(clock.latePress(BOUT, 'resume', press('10:05:00'))).rejects.toThrow(
      'Could not read the timeline of bout m1: timeout',
    );
    wroteNothing(db);
  });
});

describe('two writers on one bout', () => {
  it('a press whose sequence was taken is judged again, and written at the next one', async () => {
    const { db, rows, clock } = setup(HALTED);
    collide(db, 1, () => rows.push(row(3, 'adjust_time', '10:00:35')));

    await clock.latePress(BOUT, 'resume', press('10:05:00'));

    expect(writesTo(db, 'match_events').map((write) => write.row)).toEqual([
      expect.objectContaining({ sequence: 4, type: 'resume', client_uuid: PRESS }),
    ]);
    expect(writesTo(db, 'matches')).toHaveLength(1);
  });

  it('a press that another send saved meanwhile is answered, and written once', async () => {
    const { db, rows, clock } = setup(HALTED);
    collide(db, 1, () => rows.push(row(3, 'resume', '10:05:00', { client_uuid: PRESS })));

    const answer = await clock.latePress(BOUT, 'resume', press('10:05:00'));

    expect(answer.status).toBe('running');
    wroteNothing(db);
  });

  it('a Resume that loses to an End is judged on the ended clock, and not written', async () => {
    // Another tablet ended the clock between this press's rules and its
    // insert. A new sequence alone would put a completed bout back to running.
    const { db, rows, clock } = setup(HALTED);
    collide(db, 1, () => rows.push(row(3, 'end', '10:06:00')));

    expect(await refusalOf(clock.latePress(BOUT, 'resume', press('10:05:00')))).toEqual({
      status: 409,
      code: 'clock_press_out_of_order',
    });
    wroteNothing(db);
  });

  it('an End that loses to an End is already true', async () => {
    const { db, rows, clock } = setup(HALTED);
    collide(db, 1, () => rows.push(row(3, 'end', '10:06:00')));

    await expect(clock.latePress(BOUT, 'end', press('10:05:00'))).resolves.toMatchObject({
      status: 'ended',
    });
    wroteNothing(db);
  });

  it('gives up after three tries, with a code the pad holds', async () => {
    const { db, clock } = setup(HALTED);
    collide(db, 3);

    expect(await refusalOf(clock.latePress(BOUT, 'resume', press('10:05:00')))).toEqual({
      status: 409,
      code: 'clock_row_collided',
    });
    wroteNothing(db);
  });

  it('a press of the pad of before is refused as before, and carries no id', async () => {
    const collided = setup(HALTED);
    collide(collided.db, 1);
    await expect(collided.clock.clockAction(BOUT, 'resume')).rejects.toThrow('duplicate key value');
    wroteNothing(collided.db);

    const { db, clock } = setup(HALTED);
    await clock.clockAction(BOUT, 'resume');
    const [written] = writesTo(db, 'match_events');
    expect(written?.row).toMatchObject({ sequence: 3, type: 'resume', occurred_at: NOW });
    expect(written?.row).not.toHaveProperty('client_uuid');
  });

  it('a bout row that is not updated is an error: the clock row is saved by then', async () => {
    const { db, clock } = setup(HALTED);
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'matches') return chain;
      chain.update = vi.fn(() =>
        supabaseChain({ data: null, error: { message: 'timeout' } }),
      ) as never;
      return chain;
    }) as never;

    await expect(clock.latePress(BOUT, 'resume', press('10:05:00'))).rejects.toThrow(
      'Clock row saved, bout m1 not updated: timeout',
    );
  });

  it('any other failure of the insert is an error at once', async () => {
    const { db, clock } = setup(HALTED);
    const real = db.service.from;
    let inserts = 0;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      chain.insert = vi.fn(() => {
        inserts += 1;
        return Promise.resolve({ error: { code: '23503', message: 'no such bout' } });
      }) as never;
      return chain;
    }) as never;

    await expect(clock.latePress(BOUT, 'resume', press('10:05:00'))).rejects.toThrow(
      'no such bout',
    );
    expect(inserts).toBe(1);
  });
});

describe('the press a clock body names', () => {
  const whole = { clientUuid: PRESS, pressedAt: at('10:00:00'), sentAt: NOW };

  it('is none for the body of the pad of before', () => {
    expect(latePressOf({ action: 'start' })).toBeNull();
    expect(latePressOf({ action: 'reopen' })).toBeNull();
  });

  it.each(['start', 'halt', 'resume', 'end'] as const)('is a whole %s', (action) => {
    expect(latePressOf({ action, ...whole })).toEqual({ action, ...whole });
  });

  it.each(['clientUuid', 'pressedAt', 'sentAt'] as const)(
    'refuses half a press: no %s',
    (missing) => {
      const { [missing]: _, ...half } = whole;
      expect(() => latePressOf({ action: 'start', ...half })).toThrow(/names its id/);
    },
  );

  it.each(['reopen', 'reset_clock'] as const)('refuses a %s with an id', (action) => {
    expect(() => latePressOf({ action, ...whole })).toThrow(/a start, a halt, a resume or an end/);
  });
});
