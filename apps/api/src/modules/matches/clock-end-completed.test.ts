import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * A clock End on a bout that is already completed stops the clock and decides
 * nothing: the bout keeps the result it was completed with.
 *
 * A forfeit, a black card and the points cap complete the bout FIRST and stop
 * its clock after. The End read the winner they had just written, called the
 * bout "decided on time" and wrote `time_limit` over their reason. A forfeit on
 * a bout that had started then no longer read as a forfeit: the hold of ruling
 * 322 let it go, and the pad showed no black card banner.
 */
const BOUT = 'm1';
const AT = (second: number) => `2026-04-25T09:00:${String(second).padStart(2, '0')}.000Z`;
const HALTED = [
  { id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0) },
  { id: 'e2', match_id: BOUT, sequence: 2, type: 'halt', occurred_at: AT(30) },
];

function endOn(row: Record<string, unknown>) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          locked_at: null,
          started_at: AT(0),
          rounds_json: null,
          current_round: 1,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          match_number_label: 'P1M1',
          phases: { type: 'pool', tournaments: { ruleset_config: {} } },
          ...row,
        },
      ],
    },
    match_events: {
      rows: HALTED.map((event) => ({ reason: null, adjustment_ms: null, ...event })),
    },
  });
  return { db, clock: new ClockService(db as never) };
}

/** The columns of the one write to the bout's row. */
async function writtenByEnd(row: Record<string, unknown>) {
  const { db, clock } = endOn(row);
  await clock.clockAction(BOUT, 'end', 'auto');
  const writes = writesTo(db, 'matches');
  expect(writes).toHaveLength(1);
  return Object.keys(writes[0]?.row as Record<string, unknown>).sort();
}

const CLOCK_ONLY = ['duration_active_ms', 'duration_total_ms', 'ended_at', 'status'];
const ended = (by: Record<string, unknown>) => ({ status: 'completed', ended_at: AT(30), ...by });

describe('ClockService.clockAction end — a bout already completed', () => {
  it.each(['forfeit', 'black_card', 'override'])(
    'keeps the result a %s record gave it',
    async (endReason) => {
      const forfeited = ended({
        red_score: 0,
        blue_score: 5,
        winner_registration_id: 'blue',
        end_reason: endReason,
      });

      expect(await writtenByEnd(forfeited)).toEqual(CLOCK_ONLY);
    },
  );

  it('keeps the result the points cap gave it', async () => {
    const capped = ended({
      red_score: 5,
      blue_score: 3,
      winner_registration_id: 'red',
      end_reason: 'first_to_points',
    });

    expect(await writtenByEnd(capped)).toEqual(CLOCK_ONLY);
  });

  it('still names the leader of a bout that runs out of time', async () => {
    const fought = { status: 'paused', red_score: 3, blue_score: 1, winner_registration_id: null };

    expect(await writtenByEnd(fought)).toEqual(
      [...CLOCK_ONLY, 'end_reason', 'winner_registration_id'].sort(),
    );
  });
});
