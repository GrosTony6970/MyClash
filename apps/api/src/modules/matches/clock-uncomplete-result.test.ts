import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * Ruling 331: a bout the clock takes out of `completed` carries no result.
 *
 * Dupont beat Martin 5-3. The referee pressed Reopen to void a wrong hit, they
 * fought on, Martin led 4-5 when the time ran out. The Reopen had kept "winner:
 * Dupont" on the paused bout, and the End reads a recorded winner before the
 * board: Dupont won a bout Martin led.
 */
const BOUT = 'm1';
const AT = (minute: number) => `2026-04-25T09:0${minute}:00.000Z`;

const STARTED = [{ id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0) }];
const ENDED = [
  ...STARTED,
  { id: 'e2', match_id: BOUT, sequence: 2, type: 'end', occurred_at: AT(1) },
];

function setup(row: Record<string, unknown>, events: Record<string, unknown>[]) {
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
      rows: events.map((event) => ({ reason: null, adjustment_ms: null, ...event })),
    },
  });
  const completion = { onMatchUncompleted: vi.fn().mockResolvedValue(undefined) };
  return { db, completion, clock: new ClockService(db as never, completion as never) };
}

const WON = {
  status: 'completed',
  red_score: 5,
  blue_score: 3,
  winner_registration_id: 'red',
  end_reason: 'first_to_points',
  ended_at: AT(1),
};

/** The one write to the bout's row, whole. */
function rowWrite(db: ReturnType<typeof setup>['db']) {
  const writes = writesTo(db, 'matches');
  expect(writes).toHaveLength(1);
  expect(scopedTo(writes[0], 'id')).toBe(BOUT);
  return writes[0]?.row;
}

describe('ClockService.clockAction — a bout taken out of completed (ruling 331)', () => {
  it('a Reopen leaves no winner and no end reason on the bout', async () => {
    const { db, completion, clock } = setup(WON, ENDED);

    await clock.clockAction(BOUT, 'reopen');

    expect(completion.onMatchUncompleted).toHaveBeenCalledTimes(1);
    expect(rowWrite(db)).toEqual({
      status: 'paused',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
      locked_at: null,
      duration_total_ms: null,
    });
  });

  it('a Start on a bout a forfeit ended before it began leaves none either', async () => {
    // A no-show: the forfeit completed a bout whose clock never ran, so the
    // clock is idle and Start is its one legal action.
    const { db, completion, clock } = setup(
      {
        ...WON,
        red_score: 0,
        blue_score: 5,
        winner_registration_id: 'blue',
        end_reason: 'forfeit',
      },
      [],
    );

    await clock.clockAction(BOUT, 'start');

    expect(completion.onMatchUncompleted).toHaveBeenCalledTimes(1);
    expect(rowWrite(db)).toEqual({
      status: 'running',
      started_at: expect.any(String),
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
    });
  });

  it('a Resume on a completed bout whose clock is halted leaves none, and no start time', async () => {
    const halted = [
      ...STARTED,
      { id: 'e2', match_id: BOUT, sequence: 2, type: 'halt', occurred_at: AT(1) },
    ];
    const { db, clock } = setup(WON, halted);

    await clock.clockAction(BOUT, 'resume');

    expect(rowWrite(db)).toEqual({
      status: 'running',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
    });
  });

  it('a Halt on a completed bout whose clock still runs leaves none', async () => {
    // A forfeit whose own clock End failed: completed, with a running clock.
    const { db, clock } = setup(WON, STARTED);

    await clock.clockAction(BOUT, 'halt');

    expect(rowWrite(db)).toEqual({
      status: 'paused',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
    });
  });

  it('a Halt on a bout being fought writes its status alone', async () => {
    const { db, completion, clock } = setup(
      { status: 'running', red_score: 2, blue_score: 1 },
      STARTED,
    );

    await clock.clockAction(BOUT, 'halt');

    expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
    expect(rowWrite(db)).toEqual({ status: 'paused' });
  });
});
