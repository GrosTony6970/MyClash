import { vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { BOUT, PRESS, RUNNING, at, press, row } from './clock-late-press.fixtures';
import { ScoringService } from './scoring.service';

/**
 * "End round" on time, sent late by a tablet (operator, 2026-10-10).
 *
 * A best-of-3 bout, no wifi from 10:00 to 11:00. The clock of round 1 runs
 * from 10:00:00 and its 90 seconds are over at 10:01:30. Blue leads 2-1 and
 * the official taps "End round". At 11:00 the tablet sends its queue: the
 * server closes round 1 once, for the leader, at 10:01:30.
 */
export const STAFF = { staffAccountId: 'staff-1' };
export const SAVED = row(2, 'round_end', '10:01:30', { client_uuid: PRESS });

export const hit = (sequence: number, color: 'red' | 'blue', value: number) => ({
  id: `x${sequence}`,
  client_uuid: `u${sequence}`,
  match_id: BOUT,
  sequence,
  type: 'clean',
  occurred_at: at('10:00:10'),
  first_striker_color: color,
  first_strike_value: value,
  afterblow_value: null,
  no_exchange_reason: null,
  round_number: 1,
  voided: false,
});
export const BLUE_LEADS = [hit(1, 'blue', 2), hit(2, 'red', 1)];
export const LEVEL = [hit(1, 'blue', 2), hit(2, 'red', 2)];
/** Round 1 as the server closed it: blue, 2-1. */
export const CLOSED = {
  round: 1,
  redScore: 1,
  blueScore: 2,
  winnerColor: 'blue',
  endReason: 'time_limit',
};
export const ROUND_1_CLOSED = {
  rounds_json: [CLOSED],
  blue_round_wins: 1,
  awaiting_round_advance: true,
};

/** An "End round `round`" tapped at `pressed` and sent at 11:00. */
export const endRound = (pressed: string, round = 1) => ({ ...press(pressed), round });

/** The bout: a best-of-3 in its round 1, 90 seconds a round. */
export const boutRow = (bout: SupabaseRow, eventStatus: string) => ({
  id: BOUT,
  red_registration_id: 'red',
  blue_registration_id: 'blue',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  status: 'running',
  locked_at: null,
  started_at: at('10:00:00'),
  winner_registration_id: null,
  match_number_label: 'QF1',
  current_round: 1,
  rounds_json: null,
  red_round_wins: 0,
  blue_round_wins: 0,
  red_score: 1,
  blue_score: 2,
  awaiting_round_advance: false,
  phases: {
    type: 'single_elim',
    tournaments: {
      ruleset_config: {
        matchFormat: {
          pointCap: 10,
          timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
          bestOf: { pool: 3, bracket: 3, finals: 3 },
        },
      },
      scoring_config_json: null,
      events: { status: eventStatus },
    },
  },
  ...bout,
});

export function series(
  hits: SupabaseRow[] = BLUE_LEADS,
  events: SupabaseRow[] = RUNNING,
  bout: SupabaseRow = {},
  eventStatus = 'running',
) {
  const rows = [...events];
  const db = mockSupabase({
    matches: { rows: [boutRow(bout, eventStatus)] },
    exchanges: { rows: hits },
    match_penalties: { rows: [] },
    match_events: { rows },
  });
  const scoring = new ScoringService(
    db as never,
    { resolve: vi.fn().mockResolvedValue(null) } as never,
    new ClockService(db as never),
  );
  return { db, rows, scoring };
}

export const written = (db: ReturnType<typeof series>['db']) =>
  db.writes.map((write) => `${write.table} ${(write.row as { type?: string }).type ?? write.op}`);
