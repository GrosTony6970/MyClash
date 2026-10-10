import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseChain, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import {
  BOUT,
  HALTED,
  NOW,
  PRESS,
  RUNNING,
  collide,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import { BLUE_LEADS, ROUND_1_CLOSED, STAFF, endRound, series, written } from './round-end.fixtures';

/** A late "End round" the server never took, and the "End round" of a pad with a network. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a late "End round" the server does not hold', () => {
  it('is done, and writes nothing, when that round is closed', async () => {
    const { db, scoring } = series(BLUE_LEADS, HALTED, ROUND_1_CLOSED);

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).resolves.toEqual({
      redScore: 1,
      blueScore: 2,
    });
    wroteNothing(db);
  });

  it.each(['completed', 'archived'])('is refused on a %s Event', async (eventStatus) => {
    const { db, scoring } = series(BLUE_LEADS, RUNNING, {}, eventStatus);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30')))).toEqual({
      status: 409,
      code: 'event_results_frozen',
    });
    wroteNothing(db);
  });

  it.each<[string, SupabaseRow, ReturnType<typeof endRound>, string]>([
    ['a completed bout', { status: 'completed' }, endRound('10:01:30'), 'bout_completed'],
    ['a round the bout is not in', {}, endRound('10:01:30', 2), 'round_not_open'],
    [
      'a press of more than a day ago',
      {},
      { ...endRound('10:01:30'), pressedAt: '2026-04-24T10:59:59.000Z' },
      'clock_press_too_old',
    ],
  ])('is refused for %s', async (_, bout, late, code) => {
    const { db, scoring } = series(BLUE_LEADS, RUNNING, bout);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, late))).toEqual({
      status: 409,
      code,
    });
    wroteNothing(db);
  });

  it('is refused when the bout was reset after the tap', async () => {
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, row(2, 'reset_match', '10:30:00')]);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30')))).toEqual({
      status: 409,
      code: 'scored_before_reset',
    });
    wroteNothing(db);
  });

  it('is written at the next sequence when its own was taken', async () => {
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(row(2, 'adjust_time', '10:00:35')));

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 3,
      type: 'round_end',
      client_uuid: PRESS,
    });
  });

  it('asks every rule again when its sequence was taken: a bout reset meanwhile takes none', async () => {
    // The row that won was a Reset. A new sequence alone would end a round of
    // the fight that was cancelled.
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(row(2, 'reset_match', '10:30:00')));

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30')))).toEqual({
      status: 409,
      code: 'scored_before_reset',
    });
    wroteNothing(db);
  });

  it('is a bad request on a bout that is not a best-of', async () => {
    const single = { ruleset_config: { matchFormat: {} }, events: { status: 'running' } };
    const { db, scoring } = series(BLUE_LEADS, RUNNING, {
      phases: { type: 'single_elim', tournaments: single },
    });

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).rejects.toThrow(
      'Not a best-of match',
    );
    wroteNothing(db);
  });

  it('says so, as a fault a pad sends again, when the bout row is not updated', async () => {
    const { db, scoring } = series();
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'matches') return chain;
      chain.update = vi.fn(() =>
        supabaseChain({ data: null, error: { message: 'timeout' } }),
      ) as never;
      return chain;
    }) as never;
    const sent = scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    await expect(sent).rejects.toThrow('Round 1 not closed on bout m1: timeout');
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe('"End round" of the pad of before, with no id', () => {
  it('closes the round now: the bout, then a line with no id, then the clock', async () => {
    const { db, scoring } = series();

    await expect(scoring.endRoundOnTime(BOUT, STAFF)).resolves.toEqual({
      redScore: 1,
      blueScore: 2,
    });

    expect(written(db)).toEqual([
      'matches update',
      'match_events round_end',
      'match_events halt',
      'matches update',
    ]);
    const [line, halt] = writesTo(db, 'match_events').map((write) => write.row);
    expect(line).toMatchObject({ type: 'round_end', occurred_at: NOW });
    expect(line).not.toHaveProperty('client_uuid');
    expect(halt).toMatchObject({ type: 'halt', occurred_at: NOW });
  });

  it('closes the round also when its line cannot be written', async () => {
    const { db, scoring } = series();
    collide(db, 1);

    await expect(scoring.endRoundOnTime(BOUT, STAFF)).resolves.toEqual({
      redScore: 1,
      blueScore: 2,
    });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ awaiting_round_advance: true });
  });

  it.each<[string, SupabaseRow, string]>([
    ['a completed bout', { status: 'completed' }, 'Match is already completed'],
    [
      'a round that waits for the next one',
      { ...ROUND_1_CLOSED, status: 'completed' },
      'Match is already completed',
    ],
    ['a round already ended', ROUND_1_CLOSED, 'Round already ended — advance to the next round'],
    [
      'a round already closed',
      { ...ROUND_1_CLOSED, awaiting_round_advance: false },
      'Round already closed',
    ],
  ])('refuses %s in the words the pad of today reads', async (_, bout, words) => {
    const { db, scoring } = series(BLUE_LEADS, HALTED, bout);

    const refused = scoring.endRoundOnTime(BOUT, STAFF);

    await expect(refused).rejects.toMatchObject({ status: 400, response: { message: words } });
    wroteNothing(db);
  });
});
