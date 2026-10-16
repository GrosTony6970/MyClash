import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * A Start, a Halt or a Resume that takes a series out of `completed` puts back the round that
 * ended it, as a Reopen does.
 *
 * Dupont won rounds 1 and 2 of a best-of-3, and the series ended on its last hit with the clock
 * never started (so no End landed). The referee pressed Start to fight on. The bout came out of
 * `completed` with no winner, but round 2 stayed closed and the series stayed won: no hit could
 * close it again, and a later End completed the bout with no winner at all.
 */
const BOUT = 'm1';
const AT = '2026-04-25T09:00:00.000Z';

const round = (n: number, winnerColor: 'red' | 'blue') => ({
  round: n,
  redScore: winnerColor === 'red' ? 5 : 2,
  blueScore: winnerColor === 'red' ? 2 : 5,
  winnerColor,
  endReason: 'first_to_points',
});

function setup(row: Record<string, unknown>) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'completed',
          locked_at: null,
          started_at: null,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: 'red',
          red_score: 5,
          blue_score: 2,
          awaiting_round_advance: false,
          match_number_label: 'T1',
          phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
          ...row,
        },
      ],
    },
    // The clock never ran: an idle clock, which a Start leaves.
    match_events: { rows: [] },
  });
  const completion = { onMatchUncompleted: vi.fn().mockResolvedValue(undefined) };
  return { db, clock: new ClockService(db as never, completion as never) };
}

describe('ClockService.clockAction — a Start that takes a series out of completed', () => {
  it('puts back the round whose close ended the series', async () => {
    const { db, clock } = setup({
      current_round: 2,
      rounds_json: [round(1, 'red'), round(2, 'red')],
    });

    vi.useFakeTimers({ now: new Date(AT) });
    try {
      await clock.clockAction(BOUT, 'start');
    } finally {
      vi.useRealTimers();
    }

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      status: 'running',
      winner_registration_id: null,
      rounds_json: [round(1, 'red')],
      red_round_wins: 1,
      blue_round_wins: 0,
      current_round: 2,
      awaiting_round_advance: false,
    });
  });

  it('keeps the closed rounds of a series a forfeit ended mid-round', async () => {
    const { db, clock } = setup({ current_round: 2, rounds_json: [round(1, 'red')] });

    await clock.clockAction(BOUT, 'start');

    expect(writesTo(db, 'matches')[0]?.row).not.toHaveProperty('rounds_json');
  });
});
