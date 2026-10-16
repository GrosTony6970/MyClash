import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { RESET_AFTER_LEVEL_STEP } from './reset-after-level-step';

/**
 * "Reset clock" is refused once a level step is taken (operator, 2026-10-16, "Reset + chain").
 *
 * An elimination bout is level at time. The referee grants extra time: a level step. Then "Reset
 * clock" is pressed by mistake: the clock is back to regulation time, and the chain's next step
 * is already sudden death. A Reopen keeps the chain; a Reset after a step is refused.
 */
const BOUT = 'm1';
const AT = (minute: number) => `2026-04-25T09:0${minute}:00.000Z`;

const LEVEL_AT_TIME = [
  { id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0) },
  { id: 'e2', match_id: BOUT, sequence: 2, type: 'halt', occurred_at: AT(3) },
];
const EXTRA_TIME_GIVEN = [
  ...LEVEL_AT_TIME,
  { id: 'e3', match_id: BOUT, sequence: 3, type: 'level_resolution', occurred_at: AT(4) },
];

function setup(events: Record<string, unknown>[]) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'paused',
          locked_at: null,
          started_at: AT(0),
          rounds_json: null,
          current_round: 1,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: null,
          red_score: 2,
          blue_score: 2,
          match_number_label: 'QF1',
          awaiting_round_advance: false,
          back_in_play_at: null,
          phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
        },
      ],
    },
    match_events: {
      rows: events.map((event) => ({ reason: null, adjustment_ms: null, ...event })),
    },
  });
  return { db, clock: new ClockService(db as never) };
}

describe('ClockService.clockAction — Reset clock after a level step', () => {
  it('is refused with its code, and writes nothing', async () => {
    const { db, clock } = setup(EXTRA_TIME_GIVEN);

    const refused = await clock.clockAction(BOUT, 'reset_clock').catch((e: unknown) => e);

    expect((refused as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
      code: RESET_AFTER_LEVEL_STEP,
    });
    expect(writesTo(db, 'match_events')).toEqual([]);
  });

  it('still resets a clock no level step has touched', async () => {
    const { db, clock } = setup(LEVEL_AT_TIME);

    await clock.clockAction(BOUT, 'reset_clock');

    expect(
      writesTo(db, 'match_events').map((write) => (write.row as { type: string }).type),
    ).toEqual(['reset_clock']);
  });
});
