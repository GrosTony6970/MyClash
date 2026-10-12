import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { mockSupabase, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';

/**
 * A Reopen puts back on the board the round whose close ended the series, and
 * no other.
 *
 * Dupont won round 1 of a best-of-3. In round 2 Martin was forfeited. The
 * referee pressed Reopen: the forfeit closed no round, and the Reopen removed
 * round 1 from the series all the same. A round ended on time cannot be read
 * back from its sheet, so Dupont's round was lost.
 */
const BOUT = 'm1';
const AT = (minute: number) => `2026-04-25T09:0${minute}:00.000Z`;
const ENDED = [
  { id: 'e1', match_id: BOUT, sequence: 1, type: 'start', occurred_at: AT(0) },
  { id: 'e2', match_id: BOUT, sequence: 2, type: 'end', occurred_at: AT(1) },
];

const round = (n: number, winnerColor: 'red' | 'blue') => ({
  round: n,
  redScore: winnerColor === 'red' ? 5 : 2,
  blueScore: winnerColor === 'red' ? 2 : 5,
  winnerColor,
  endReason: 'time_limit',
});

function setup(row: Record<string, unknown>) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'completed',
          locked_at: null,
          started_at: AT(0),
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: 'red',
          red_score: 5,
          blue_score: 0,
          awaiting_round_advance: false,
          match_number_label: 'T1',
          phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
          ...row,
        },
      ],
    },
    match_events: {
      rows: ENDED.map((event) => ({ reason: null, adjustment_ms: null, ...event })),
    },
  });
  const completion = { onMatchUncompleted: vi.fn().mockResolvedValue(undefined) };
  return { db, clock: new ClockService(db as never, completion as never) };
}

/** The one write to the bout's row, whole. */
function rowWrite(db: ReturnType<typeof setup>['db']) {
  const writes = writesTo(db, 'matches');
  expect(writes).toHaveLength(1);
  expect(scopedTo(writes[0], 'id')).toBe(BOUT);
  return writes[0]?.row;
}

/** What a Reopen writes when it moves the clock alone. */
const CLOCK_ALONE = {
  status: 'paused',
  winner_registration_id: null,
  end_reason: null,
  ended_at: null,
  locked_at: null,
  duration_total_ms: null,
};
/** With the mark of a bout put back in play (`backInPlayColumns`). */
const BACK_IN_PLAY = { ...CLOCK_ALONE, back_in_play_at: expect.any(String) };

describe('ClockService.clockAction — the round a Reopen puts back', () => {
  it('a series a forfeit ended in round 2 keeps its closed round 1', async () => {
    const { db, clock } = setup({
      rounds_json: [round(1, 'red')],
      current_round: 2,
      end_reason: 'forfeit',
    });

    await clock.clockAction(BOUT, 'reopen');

    expect(rowWrite(db)).toEqual(BACK_IN_PLAY);
  });

  it('a series a forfeit ended between two rounds keeps the round, and still waits', async () => {
    const { db, clock } = setup({
      rounds_json: [round(1, 'red')],
      current_round: 1,
      awaiting_round_advance: true,
      end_reason: 'forfeit',
    });

    await clock.clockAction(BOUT, 'reopen');

    expect(rowWrite(db)).toEqual(BACK_IN_PLAY);
  });

  it('a series its last round ended gets that round back on the board', async () => {
    const { db, clock } = setup({
      rounds_json: [round(1, 'red'), round(2, 'red')],
      current_round: 2,
      end_reason: 'time_limit',
    });

    await clock.clockAction(BOUT, 'reopen');

    expect(rowWrite(db)).toEqual({
      ...BACK_IN_PLAY,
      rounds_json: [round(1, 'red')],
      red_round_wins: 1,
      blue_round_wins: 0,
      current_round: 2,
      awaiting_round_advance: false,
    });
  });

  it('marks the bout as put back in play at the time of its own row', async () => {
    const { db, clock } = setup({ rounds_json: null, current_round: 1 });
    vi.useFakeTimers({ now: new Date('2026-04-25T10:10:00.000Z') });
    onTestFinished(() => void vi.useRealTimers());

    await clock.clockAction(BOUT, 'reopen');

    const line = writesTo(db, 'match_events')[0]?.row as { type: string; occurred_at: string };
    expect(line).toMatchObject({ type: 'reopen', occurred_at: '2026-04-25T10:10:00.000Z' });
    expect(rowWrite(db)).toMatchObject({ back_in_play_at: '2026-04-25T10:10:00.000Z' });
  });

  it('leaves no mark on a bout that is not completed: only the clock moves', async () => {
    // A forfeit ended the clock and was taken back: the bout is as it was
    // before, and a tablet's presses from before this Reopen are not stale.
    const { db, clock } = setup({ status: 'running', winner_registration_id: null });

    await clock.clockAction(BOUT, 'reopen');

    expect(rowWrite(db)).toEqual(CLOCK_ALONE);
  });

  it('leaves no mark on a bout that waits for its next round: only the clock moves', async () => {
    // The Reopen "Start round 2" makes itself, on a clock somebody ended.
    const { db, clock } = setup({
      status: 'paused',
      winner_registration_id: null,
      rounds_json: [round(1, 'red')],
      current_round: 1,
      awaiting_round_advance: true,
    });

    await clock.clockAction(BOUT, 'reopen', 'round advance');

    expect(rowWrite(db)).toEqual(CLOCK_ALONE);
  });

  it('reads whether the series waits for its next round', async () => {
    const { db, clock } = setup({ rounds_json: null, current_round: 1 });

    await clock.clockAction(BOUT, 'reopen');

    expect(selectsFor(db.from, 'matches')[0]).toContain('awaiting_round_advance');
  });
});
