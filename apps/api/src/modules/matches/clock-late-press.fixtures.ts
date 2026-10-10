import type { HttpException } from '@nestjs/common';
import { expect, vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import type { LatePress } from './late-press';

/**
 * A clock press sent late (operator rulings 11 to 14 of the quick-win list).
 *
 * A table has no wifi from 10:00 to 11:00. The official starts the clock,
 * stops it, scores and ends the bout. The tablet keeps each press with an id
 * and its own time, and sends them at 11:00. The server takes each press once,
 * puts it where it happened, and never lets it undo what somebody did since.
 */
export const BOUT = 'm1';
export const PRESS = 'a0000000-0000-4000-8000-0000000000aa';
/** The server's time when the tablet's queue arrives. */
export const NOW = '2026-04-25T11:00:00.000Z';
export const at = (clock: string) => `2026-04-25T${clock}.000Z`;

/** A press made at `pressed` and sent at 11:00, on a tablet whose clock is `skewMinutes` wrong. */
export function press(pressed: string, skewMinutes = 0, clientUuid = PRESS): LatePress {
  const tablet = (iso: string) => new Date(Date.parse(iso) + skewMinutes * 60_000).toISOString();
  return { clientUuid, pressedAt: tablet(at(pressed)), sentAt: tablet(NOW) };
}

export const row = (sequence: number, type: string, clock: string, more: SupabaseRow = {}) => ({
  id: `e${sequence}`,
  match_id: BOUT,
  sequence,
  type,
  occurred_at: at(clock),
  reason: null,
  adjustment_ms: null,
  ...more,
});

export const IDLE: SupabaseRow[] = [];
export const RUNNING = [row(1, 'start', '10:00:00')];
export const HALTED = [...RUNNING, row(2, 'halt', '10:00:30')];
export const ENDED = [...HALTED, row(3, 'end', '10:00:40')];

export function setup(events: SupabaseRow[], bout: SupabaseRow = {}, eventStatus = 'running') {
  const rows = [...events];
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'running',
          locked_at: null,
          started_at: at('10:00:00'),
          rounds_json: null,
          current_round: 1,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          winner_registration_id: null,
          red_score: 3,
          blue_score: 1,
          match_number_label: 'P1M1',
          awaiting_round_advance: false,
          phases: {
            type: 'pool',
            tournaments: { ruleset_config: {}, events: { status: eventStatus } },
          },
          ...bout,
        },
      ],
    },
    match_events: { rows },
  });
  const completion = { onMatchCompleted: vi.fn(), onMatchUncompleted: vi.fn() };
  return { db, rows, completion, clock: new ClockService(db as never, completion as never) };
}

/** The code and the status of a refusal. */
export async function refusalOf(attempt: Promise<unknown>) {
  const error = (await attempt.then(
    () => {
      throw new Error('expected a refusal');
    },
    (thrown: unknown) => thrown,
  )) as HttpException;
  const body = error.getResponse() as { code?: string };
  return { status: error.getStatus(), code: body.code };
}

export const wroteNothing = (db: ReturnType<typeof setup>['db']) => expect(db.writes).toEqual([]);

/** The next `times` inserts of a clock row fail on a unique key. */
export function collide(
  db: ReturnType<typeof setup>['db'],
  times: number,
  onCollision?: () => void,
) {
  const real = db.service.from;
  let left = times;
  db.service.from = vi.fn((table: string) => {
    const chain = real(table);
    if (table !== 'match_events') return chain;
    const insert = chain.insert;
    chain.insert = vi.fn((written: unknown) => {
      if (left === 0) return insert(written);
      left -= 1;
      onCollision?.();
      return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } });
    }) as never;
    return chain;
  }) as never;
}
