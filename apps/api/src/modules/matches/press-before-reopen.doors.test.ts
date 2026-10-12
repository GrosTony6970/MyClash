import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  ENDED,
  HALTED,
  NOW,
  PRESS,
  RUNNING,
  at,
  press,
  refusalOf,
  row,
  setup,
  wroteNothing,
} from './clock-late-press.fixtures';
import * as advances from './round-advance.fixtures';
import * as ends from './round-end.fixtures';

/**
 * A press a tablet made before its bout was last put back in play, at the
 * three doors of a press sent late (`press-before-reopen.ts`).
 *
 * A table has no wifi from 10:00 to 11:00. Somebody with a network ended the
 * bout, then put it back in play at 10:10 to correct a hit. At 11:00 the
 * tablet sends what it kept: a press of 10:05 is for the bout as it was before
 * the correction, a press of 10:15 was made on the corrected bout.
 */
const MARKED = { back_in_play_at: at('10:10:00') };
const REFUSED = { status: 409, code: 'pressed_before_reopen' };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a clock press and the last time its bout was put back in play', () => {
  it.each(['end', 'resume'] as const)('a %s made before it is refused', async (action) => {
    const { db, clock } = setup(HALTED, MARKED);

    expect(await refusalOf(clock.latePress(BOUT, action, press('10:05:00')))).toEqual(REFUSED);
    wroteNothing(db);
  });

  it.each(['end', 'resume'] as const)('a %s made after it is taken', async (action) => {
    const { db, clock } = setup(HALTED, MARKED);

    await clock.latePress(BOUT, action, press('10:15:00'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ type: action });
  });

  it('is judged on how old the press is, not on the tablet’s time of day', async () => {
    // Pressed at 10:15, after the mark. This tablet's clock says 09:15.
    const late = setup(HALTED, MARKED);
    await late.clock.latePress(BOUT, 'end', press('10:15:00', -60));
    expect(writesTo(late.db, 'match_events')).toHaveLength(1);

    // Pressed at 10:05, before the mark. This tablet's clock says 11:05.
    const early = setup(HALTED, MARKED);
    expect(await refusalOf(early.clock.latePress(BOUT, 'end', press('10:05:00', 60)))).toEqual(
      REFUSED,
    );
  });

  it.each([
    ['a locked bout', HALTED, { locked_at: NOW }, 'resume'],
    ['a press the clock cannot take', ENDED, {}, 'start'],
  ] as const)('is said before %s: no new send cures it', async (_, events, bout, action) => {
    const { db, clock } = setup(events, { ...bout, ...MARKED });

    expect(await refusalOf(clock.latePress(BOUT, action, press('10:05:00')))).toEqual(REFUSED);
    wroteNothing(db);
  });

  it('a press the server holds is answered, whatever the mark says', async () => {
    const saved = [...ENDED.slice(0, 2), row(3, 'end', '10:00:40', { client_uuid: PRESS })];
    const { db, clock } = setup(saved, { status: 'completed', ...MARKED });

    await expect(clock.latePress(BOUT, 'end', press('10:00:40'))).resolves.toMatchObject({
      status: 'ended',
    });
    wroteNothing(db);
  });

  it('a press that asks for the state the clock is in is done, not refused', async () => {
    const { db, clock } = setup(HALTED, MARKED);

    await expect(clock.latePress(BOUT, 'halt', press('10:05:00'))).resolves.toMatchObject({
      status: 'halted',
    });
    wroteNothing(db);
  });

  it('reads the mark with the bout', async () => {
    const { db, clock } = setup(HALTED);

    await clock.latePress(BOUT, 'resume', press('10:05:00'));

    // The double ignores the projection: without this the column can leave the read.
    expect(selectsFor(db.from, 'matches')[0]).toContain('back_in_play_at');
  });

  it('is an error when the read does not carry the mark', async () => {
    const { db, clock } = setup(HALTED, { back_in_play_at: undefined });

    await expect(clock.latePress(BOUT, 'resume', press('10:05:00'))).rejects.toThrow(
      'Could not read when bout m1 was last put back in play',
    );
    wroteNothing(db);
  });
});

describe('a late "End round" and the last time its bout was put back in play', () => {
  const { BLUE_LEADS, ROUND_1_CLOSED, SAVED, STAFF, endRound, series, written } = ends;

  it('is refused when it was tapped before it', async () => {
    const { db, scoring } = series(BLUE_LEADS, RUNNING, MARKED);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:05:00')))).toEqual(
      REFUSED,
    );
    wroteNothing(db);
  });

  it('is refused before "the bout is not in that round": no new send cures it', async () => {
    const { scoring } = series(BLUE_LEADS, RUNNING, MARKED);

    expect(await refusalOf(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:05:00', 2)))).toEqual(
      REFUSED,
    );
  });

  it('closes the round when it was tapped after it', async () => {
    const { db, scoring } = series(BLUE_LEADS, RUNNING, MARKED);

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:15:00'));

    expect(written(db)).toContain('match_events round_end');
  });

  it('one the server holds, cut short after its row, is finished whatever the mark says', async () => {
    const { db, scoring } = series(BLUE_LEADS, [...RUNNING, SAVED], MARKED);

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ awaiting_round_advance: true });
  });

  it('is done, not refused, when that round is closed', async () => {
    const { db, scoring } = series(BLUE_LEADS, HALTED, { ...ROUND_1_CLOSED, ...MARKED });

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:05:00'))).resolves.toEqual({
      redScore: 1,
      blueScore: 2,
    });
    wroteNothing(db);
  });

  it('reads the mark with the bout', async () => {
    const { db, scoring } = series();

    await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(selectsFor(db.from, 'matches')[0]).toContain('back_in_play_at');
  });

  it('is an error when the read does not carry the mark', async () => {
    const { db, scoring } = series(BLUE_LEADS, RUNNING, { back_in_play_at: undefined });

    await expect(scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'))).rejects.toThrow(
      'Could not read when bout m1 was last put back in play',
    );
    wroteNothing(db);
  });
});

describe('a late "Start round" and the last time its bout was put back in play', () => {
  const { OPEN, SAVED, STAFF, WAITS, advance, series, written } = advances;

  it('is refused when it was tapped before it', async () => {
    const { db, scoring } = series(HALTED, { ...WAITS, ...MARKED });

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual(
      REFUSED,
    );
    wroteNothing(db);
  });

  it('is refused before "the bout does not wait": no new send cures it', async () => {
    const reopened = { ...WAITS, awaiting_round_advance: false, ...MARKED };
    const { scoring } = series(HALTED, reopened);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual(
      REFUSED,
    );
  });

  it('opens the round when it was tapped after it', async () => {
    const { db, scoring } = series(HALTED, { ...WAITS, ...MARKED });

    await scoring.advanceRound(BOUT, STAFF, advance('10:15:00'));

    expect(written(db)).toContain('match_events round_advance');
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ current_round: 2 });
  });

  it('one the server holds, cut short after its row, is finished whatever the mark says', async () => {
    const { db, scoring } = series([...HALTED, SAVED], { ...WAITS, ...MARKED });

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    expect(written(db)).toEqual(['match_events reset_clock', 'matches update']);
  });

  it('is done, not refused, when somebody opened that round', async () => {
    const { db, scoring } = series(HALTED, { ...OPEN, ...MARKED });

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    wroteNothing(db);
  });

  it('is an error when the read does not carry the mark', async () => {
    const { db, scoring } = series(HALTED, { ...WAITS, back_in_play_at: undefined });

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).rejects.toThrow(
      'Could not read when bout m1 was last put back in play',
    );
    wroteNothing(db);
  });
});
