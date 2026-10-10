import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  HALTED,
  NOW,
  PRESS,
  RUNNING,
  at,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import {
  BLUE_LEADS,
  CLOSED,
  LEVEL,
  ROUND_1_CLOSED,
  SAVED,
  STAFF,
  endRound,
  series,
  written,
} from './round-end.fixtures';

/** The fixtures say the story: a tablet's "End round" reaches the server at 11:00. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a late "End round" of the open round', () => {
  it('writes the round’s end, closes the round for the leader, and halts the clock there', async () => {
    const { db, scoring } = series();

    const answer = await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(answer).toEqual({ redScore: 1, blueScore: 2 });
    expect(written(db)).toEqual([
      'match_events round_end',
      'matches update',
      'match_events halt',
      'matches update',
    ]);
    expect(writesTo(db, 'match_events')[0]?.row).toEqual({
      match_id: BOUT,
      sequence: 2,
      type: 'round_end',
      reason: 'round 1 ended on time',
      by_user_id: null,
      staff_account_id: 'staff-1',
      occurred_at: at('10:01:30'),
      client_uuid: PRESS,
    });
    const [bout] = writesTo(db, 'matches');
    expect(bout?.row).toMatchObject({
      rounds_json: [CLOSED],
      blue_round_wins: 1,
      red_round_wins: 0,
      awaiting_round_advance: true,
      red_score: 1,
      blue_score: 2,
      current_round: 1,
    });
    expect(bout?.filters).toContainEqual({ method: 'eq', args: ['id', BOUT] });
    expect(writesTo(db, 'match_events')[1]?.row).toMatchObject({
      type: 'halt',
      occurred_at: at('10:01:30'),
    });
  });

  it('reads the status of the bout’s Event with the bout', async () => {
    const { db, scoring } = series();

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(selectsFor(db.from, 'matches')[0]).toContain(
      'phases(type, tournaments(ruleset_config, scoring_config_json, events(status)))',
    );
  });

  it('is never placed before the row the bout ends with', async () => {
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, row(2, 'adjust_time', '10:10:00')]);

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: at('10:10:00') });
  });

  it('ends a series it decides at the time of the press, and its clock with it', async () => {
    const won = { round: 1, redScore: 0, blueScore: 10, winnerColor: 'blue', endReason: 'x' };
    const { db, scoring } = series(
      BLUE_LEADS.map((one) => ({ ...one, round_number: 2 })),
      RUNNING,
      { current_round: 2, rounds_json: [won], blue_round_wins: 1 },
    );

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30', 2));

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'blue',
      ended_at: at('10:01:30'),
    });
    expect(writesTo(db, 'match_events')[1]?.row).toMatchObject({
      type: 'end',
      occurred_at: at('10:01:30'),
    });
  });

  it('judges a level round on the time the clock had run when it was pressed', async () => {
    // Pressed 30 seconds in. An hour later the clock "has run" an hour: read
    // then, the time would be finished and the phase's remedy named.
    const early = series(LEVEL);
    expect(
      await refusalOf(early.scoring.endRoundOnTime(BOUT, STAFF, endRound('10:00:30'))),
    ).toEqual({ status: 400, code: 'time_not_finished' });
    wroteNothing(early.db);

    const atTime = series(LEVEL);
    expect(
      await refusalOf(atTime.scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))),
    ).toEqual({ status: 400, code: 'level_at_time_unresolved' });
    wroteNothing(atTime.db);
  });
});

describe('a late "End round" the server already holds', () => {
  it('is answered with the round as it was closed, and writes nothing', async () => {
    const { db, scoring } = series(BLUE_LEADS, [...HALTED, SAVED], ROUND_1_CLOSED);

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).resolves.toEqual({
      redScore: 1,
      blueScore: 2,
    });
    wroteNothing(db);
  });

  it('is finished when its round is still open: no second row, the bout and the clock', async () => {
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, SAVED]);

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(written(db)).toEqual(['matches update', 'match_events halt', 'matches update']);
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ awaiting_round_advance: true });
  });

  it.each(['completed', 'archived'])('is not finished on a %s Event', async (eventStatus) => {
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, SAVED], {}, eventStatus);

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).resolves.toEqual({
      redScore: 0,
      blueScore: 0,
    });
    wroteNothing(db);
  });

  it('is not finished on a bout a forfeit completed, nor on a bout reset since', async () => {
    const forfeited = series(BLUE_LEADS, [...RUNNING, SAVED], { status: 'completed' });
    await forfeited.scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));
    wroteNothing(forfeited.db);

    // The reset's row is behind the press's own: the press is answered.
    const reset = series(BLUE_LEADS, [...RUNNING, SAVED, row(3, 'reset_match', '10:30:00')]);
    await reset.scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));
    wroteNothing(reset.db);
  });

  it('is not finished on a round a person put back in play after it', async () => {
    // The press ended round 1 and the answer was lost. An organiser pressed
    // Reopen to correct a hit: the round is open again, and it is theirs to end.
    const reopened = [...RUNNING, SAVED, row(3, 'end', '10:01:30'), row(4, 'reopen', '10:20:00')];
    const { db, scoring } = series(BLUE_LEADS, reopened);

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).resolves.toEqual({
      redScore: 0,
      blueScore: 0,
    });
    wroteNothing(db);
  });

  it('is a bad request when the id is the id of another press', async () => {
    // Read as "saved", the id of a Halt closed the round with no row of its own.
    const halt = row(2, 'halt', '10:01:30', { client_uuid: PRESS });
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, halt]);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30')))).toEqual({
      status: 400,
      code: undefined,
    });
    wroteNothing(db);
  });
});
