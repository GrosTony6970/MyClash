import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { BOUT, NOW, PRESS, at, press, row, setup, wroteNothing } from './clock-late-press.fixtures';

/**
 * A press whose clock row was saved, but whose bout was not.
 *
 * The tablet's End reached the server: the clock row was written, then the write of the bout
 * failed, and the answer was an error. The tablet sent the End again. The server found the row
 * and answered "done" from the clock alone: the bout stayed "running" under an ended clock, with
 * no winner and no move in the bracket, for good. A lost Start left the bout "scheduled", and
 * every hit after it was held as a hit of a bout not started.
 *
 * A press sent again now finishes the bout write it missed, while it is still the row the
 * bout's timeline ends with. Behind a later row (a forfeit's own End, a Reopen) it is history,
 * and nothing is written.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

const saved = { client_uuid: PRESS };

describe('a press sent again whose bout write was lost', () => {
  it('an End completes the bout, at the time of its row, and moves the bracket', async () => {
    const { db, clock, completion } = setup([
      row(1, 'start', '10:00:00'),
      row(2, 'end', '10:00:40', saved),
    ]);

    await clock.latePress(BOUT, 'end', press('10:00:40'));

    expect(writesTo(db, 'match_events')).toEqual([]);
    const [update] = writesTo(db, 'matches');
    expect(update?.row).toMatchObject({
      status: 'completed',
      ended_at: at('10:00:40'),
      winner_registration_id: 'red',
      end_reason: 'time_limit',
    });
    expect(completion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
  });

  it('a Start puts the bout in play, started at the time of its row', async () => {
    const { db, clock } = setup([row(1, 'start', '10:00:00', saved)], {
      status: 'scheduled',
      started_at: null,
    });

    await clock.latePress(BOUT, 'start', press('10:00:00'));

    expect(writesTo(db, 'match_events')).toEqual([]);
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'running',
      started_at: at('10:00:00'),
    });
  });

  it('writes nothing when the bout already reflects it', async () => {
    const { db, clock } = setup([row(1, 'start', '10:00:00', saved)]);

    await clock.latePress(BOUT, 'start', press('10:00:00'));

    wroteNothing(db);
  });

  it('writes nothing for a press a later row stands behind', async () => {
    // The End was saved and its bout write lost; then a forfeit ended the bout and its clock,
    // and the forfeit was taken back: the bout runs, under the forfeit's End.
    const { db, clock } = setup([
      row(1, 'start', '10:00:00'),
      row(2, 'end', '10:00:40', saved),
      row(3, 'reopen', '10:01:00'),
      row(4, 'end', '10:02:00', { reason: 'auto: forfeit' }),
    ]);

    await clock.latePress(BOUT, 'end', press('10:00:40'));

    wroteNothing(db);
  });
});
