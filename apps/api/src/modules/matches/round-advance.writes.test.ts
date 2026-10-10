import { BadRequestException, HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseChain, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  HALTED,
  NOW,
  PRESS,
  collide,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import { SAVED, STAFF, WAITS, advance, series, written } from './round-advance.fixtures';

/** A round advance that fails half way, that meets another writer, or that carries no id. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a round advance that fails half way', () => {
  it('does not move the bout when the clock cannot be put to zero', async () => {
    const { db, clock, scoring, recompute } = series();
    vi.spyOn(clock, 'clockAction').mockRejectedValue(new Error('duplicate key value'));

    const sent = scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    await expect(sent).rejects.toThrow(
      'Clock of bout m1 not put to zero for round 2: duplicate key value',
    );
    // A plain error is a 5xx, which a pad sends again. A 400 or a 409 is held.
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
    expect(written(db)).toEqual(['match_events round_advance']);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('is a fault a pad sends again, also when the clock itself refuses with a 400', async () => {
    const { clock, scoring } = series();
    vi.spyOn(clock, 'clockAction').mockRejectedValue(new BadRequestException('duplicate key'));

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).rejects.not.toBeInstanceOf(
      HttpException,
    );
  });

  it('says so when the bout row is not updated', async () => {
    const { db, scoring, recompute } = series();
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'matches') return chain;
      chain.update = vi.fn(() =>
        supabaseChain({ data: null, error: { message: 'timeout' } }),
      ) as never;
      return chain;
    }) as never;

    const sent = scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    await expect(sent).rejects.toThrow('Round 2 is in the timeline, bout m1 not updated: timeout');
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
    expect(recompute).not.toHaveBeenCalled();
  });
});

describe('two writers on one round advance', () => {
  it('asks every rule again when its sequence was taken, and writes at the next one', async () => {
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(row(3, 'adjust_time', '10:00:35')));

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 4,
      type: 'round_advance',
      client_uuid: PRESS,
    });
  });

  it('is answered, and written once, when another send saved it meanwhile', async () => {
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(SAVED));

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    // The row is the other send's: this one finishes the bout, which still waits.
    expect(written(db)).toEqual(['match_events reset_clock', 'matches update']);
  });

  it('is written at the third try, after two collisions', async () => {
    const { db, scoring } = series();
    collide(db, 2);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ type: 'round_advance' });
  });

  it('gives up after three tries, with the code the pad sends again on', async () => {
    const { db, scoring } = series();
    collide(db, 3);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'clock_row_collided',
    });
    wroteNothing(db);
  });
});

describe('"Start round N+1" of the pad of before, with no id', () => {
  it('opens the next round now, and its row carries no id', async () => {
    const { db, scoring } = series();

    await expect(scoring.advanceRound(BOUT, STAFF)).resolves.toEqual({ currentRound: 2 });

    expect(written(db)).toEqual([
      'match_events round_advance',
      'match_events reset_clock',
      'matches update',
    ]);
    const [round, reset] = writesTo(db, 'match_events').map((write) => write.row);
    expect(round).toMatchObject({ sequence: 3, type: 'round_advance', occurred_at: NOW });
    expect(round).not.toHaveProperty('client_uuid');
    expect(reset).toMatchObject({ type: 'reset_clock', occurred_at: NOW });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ current_round: 2 });
  });

  it('is refused as before when its row cannot be written, and is not tried again', async () => {
    const { db, scoring } = series();
    collide(db, 1);

    await expect(scoring.advanceRound(BOUT, STAFF)).rejects.toThrow('duplicate key value');
    wroteNothing(db);
  });

  it('does not ask for the status of the Event: its door refused an over one', async () => {
    const { scoring } = series(HALTED, WAITS, 'completed');

    await expect(scoring.advanceRound(BOUT, STAFF)).resolves.toEqual({ currentRound: 2 });
  });
});
