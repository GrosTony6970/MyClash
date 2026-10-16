import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * An End that meets the desk's Reopen (S4b).
 *
 * The End read the bout running, never put back in play. Before its write, the desk put the bout
 * back in play to correct it (a Reopen, or the undo of the hit that ended it). The End's write
 * then completed the bout the desk had just opened, with nobody looking. It completes it only
 * while nothing has put it back in play since its read; else its clock row is taken back, and
 * the pad holds it as a press made before the bout was put back in play.
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

function endMeetingReopen() {
  const db = mockSupabase({
    matches: { rows: [bout()] },
    match_events: {
      rows: [
        { id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0), reason: null },
      ],
    },
  });
  // From the End's own clock row on, the bout reads as the desk left it: back in play at 09:00:40.
  const reopened = mockSupabase({ matches: { rows: [bout({ back_in_play_at: REOPENED })] } });
  const real = db.service.from;
  db.service.from = vi.fn((table: string) =>
    table === 'matches' && writesTo(db, 'match_events').length > 0
      ? reopened.from(table)
      : real(table),
  ) as never;
  const completion = { onMatchCompleted: vi.fn(), onMatchUncompleted: vi.fn() };
  return { db, reopened, completion, clock: new ClockService(db as never, completion as never) };
}

describe('ClockService.clockAction end — the desk put the bout back in play meanwhile', () => {
  it('does not complete it, takes its clock row back, and says why', async () => {
    const { db, reopened, completion, clock } = endMeetingReopen();

    const refusal = await clock.clockAction(BOUT, 'end', 'auto').then(
      () => null,
      (err: { getResponse?: () => unknown }) => err.getResponse?.(),
    );

    expect(refusal).toMatchObject({ code: 'pressed_before_reopen' });
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
    // The completion was asked only of a bout whose mark is the one the End read.
    const [write] = writesTo(reopened, 'matches');
    expect(write?.row).toMatchObject({ status: 'completed' });
    expect(write?.filters).toContainEqual({ method: 'is', args: ['back_in_play_at', null] });
    // Its row is taken back, so a resend is judged afresh.
    expect(writesTo(db, 'match_events').map((w) => w.op)).toEqual(['insert', 'delete']);
  });
});
