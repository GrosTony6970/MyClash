import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * An End that meets another write on its bout (S4b).
 *
 * The End read the bout running, never put back in play. Before its write, the desk put the bout
 * back in play to correct it (a Reopen, or the undo of the hit that ended it), or reset it, or a
 * closing hit completed it. The End's write then completed the bout the desk had just opened or
 * reset, or wrote its own winner over the one that won. It completes only a bout in the status it
 * read, with the mark it read. Lost to a reset or a put-back, its clock row is taken back and the
 * pad is told why; lost to a completion, the row stays: it is what stops the clock.
 */
const BOUT = 'm1';
const AT = (second: number) => `2026-04-25T09:00:${String(second).padStart(2, '0')}.000Z`;
const REOPENED = AT(40);

const bout = (over: SupabaseRow = {}): SupabaseRow => ({
  id: BOUT,
  status: 'running',
  locked_at: null,
  started_at: AT(0),
  rounds_json: null,
  current_round: 1,
  red_registration_id: 'red',
  blue_registration_id: 'blue',
  match_number_label: 'P1M1',
  back_in_play_at: null,
  phases: { type: 'pool', tournaments: { ruleset_config: {} } },
  ...over,
});

/** The End reads the bout as `read`; from its own clock row on, the bout reads as `since` left it. */
function endMeeting(since: SupabaseRow, read: SupabaseRow = {}) {
  const db = mockSupabase({
    matches: { rows: [bout(read)] },
    match_events: {
      rows: [
        { id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0), reason: null },
      ],
    },
  });
  const after = mockSupabase({ matches: { rows: [bout(since)] } });
  const real = db.service.from;
  db.service.from = vi.fn((table: string) =>
    table === 'matches' && writesTo(db, 'match_events').length > 0
      ? after.from(table)
      : real(table),
  ) as never;
  const completion = { onMatchCompleted: vi.fn(), onMatchUncompleted: vi.fn() };
  return { db, after, completion, clock: new ClockService(db as never, completion as never) };
}

const refusalOf = (clock: ClockService) =>
  clock.clockAction(BOUT, 'end', 'auto').then(
    () => null,
    (err: { getResponse?: () => unknown }) => err.getResponse?.(),
  );

describe('ClockService.clockAction end — another write won the bout meanwhile', () => {
  it('the desk put it back in play: no completion, its clock row taken back, and why', async () => {
    const { db, after, completion, clock } = endMeeting({ back_in_play_at: REOPENED });

    expect(await refusalOf(clock)).toMatchObject({ code: 'pressed_before_reopen' });
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    // The completion was asked only of a bout whose mark is the one the End read.
    const [write] = writesTo(after, 'matches');
    expect(write?.row).toMatchObject({ status: 'completed' });
    expect(write?.filters).toContainEqual({ method: 'is', args: ['back_in_play_at', null] });
    // Its row is taken back, so a resend is judged afresh.
    expect(writesTo(db, 'match_events').map((w) => w.op)).toEqual(['insert', 'delete']);
  });

  it('a closing hit completed it for blue: no winner over it, and its row stops the clock', async () => {
    // The hit skipped its own End: the clock read ended, with this End's row. Taken back, the
    // clock ran on the completed bout for good.
    const won = { status: 'completed', winner_registration_id: 'blue', end_reason: 'point_cap' };
    const { db, after, completion, clock } = endMeeting(won);

    expect(await refusalOf(clock)).toBeNull();
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    const [write] = writesTo(after, 'matches');
    expect(write?.filters).toContainEqual({
      method: 'in',
      args: ['status', ['running', 'paused']],
    });
    expect(writesTo(db, 'match_events').map((w) => w.op)).toEqual(['insert']);
  });

  it('another tablet halted it: the End still completes it', async () => {
    const { completion, clock } = endMeeting({ status: 'paused' });

    expect(await refusalOf(clock)).toBeNull();
    expect(completion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
  });

  it.each<[string, SupabaseRow, string[]]>([
    ['running', {}, ['running', 'paused']],
    ['completed', { status: 'completed', winner_registration_id: 'red' }, ['completed']],
  ])('the desk reset it (read %s): never written back completed', async (_, read, asked) => {
    const reset = { status: 'scheduled', winner_registration_id: null, back_in_play_at: null };
    const { db, after, completion, clock } = endMeeting(reset, read);

    expect(await refusalOf(clock)).toMatchObject({ code: 'scored_before_reset' });
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    const [write] = writesTo(after, 'matches');
    expect(write?.filters).toContainEqual({ method: 'in', args: ['status', asked] });
    expect(writesTo(db, 'match_events').map((w) => w.op)).toEqual(['insert', 'delete']);
  });

  it('judges the bout on the status and the mark it read', async () => {
    const { db, clock } = endMeeting({ back_in_play_at: REOPENED });

    await refusalOf(clock);

    const [read] = selectsFor(db.from, 'matches');
    expect(read).toMatch(/\bstatus\b/);
    expect(read).toMatch(/\bback_in_play_at\b/);
  });
});
