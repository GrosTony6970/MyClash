import { vi } from 'vitest';
import type { SupabaseRow } from '../../common/testing/supabase-chain';
import { press, row, setup } from './clock-late-press.fixtures';

/**
 * A step of a level bout (operator ruling 13, and the ruling of 2026-10-12).
 *
 * A bracket bout, 90 seconds, 2 - 2. Its chain is a minute of extra time, then
 * sudden death. The clock starts at 10:00:00, so the time is over at 10:01:30.
 * With no wifi the official taps "Extra time 60s" on the tablet; at 11:00 the
 * tablet sends its queue.
 */
export const STAFF = { staffAccountId: 'staff-1' };

/** The clock was paused at 0:00. */
export const SPENT = [row(1, 'start', '10:00:00'), row(2, 'halt', '10:01:30')];
/** The clock was paused with a minute left. */
export const EARLY = [row(1, 'start', '10:00:00'), row(2, 'halt', '10:00:30')];
/** Nobody paused the clock: it still runs. */
export const RUNS = [row(1, 'start', '10:00:00')];

/** A step the bout has taken already. */
export const taken = (sequence: number, clock: string, more: SupabaseRow = {}) =>
  row(sequence, 'level_resolution', clock, more);

/** The level bracket bout over `events`. */
export function level(events: SupabaseRow[], bout: SupabaseRow = {}, eventStatus = 'running') {
  return setup(events, {
    status: 'paused',
    red_score: 2,
    blue_score: 2,
    match_number_label: 'QF1',
    phases: {
      type: 'single_elim',
      tournaments: { ruleset_config: {}, events: { status: eventStatus } },
    },
    ...bout,
  });
}

/**
 * The double does not keep a write: a read after an insert gives the timeline
 * from before it. This puts each row written to the timeline into `rows`, so
 * the clock a door answers AFTER its write can be told from the one before.
 */
export function keepsItsRows({ db, rows }: Pick<ReturnType<typeof level>, 'db' | 'rows'>): void {
  const real = db.service.from;
  db.service.from = vi.fn((table: string) => {
    const chain = real(table);
    if (table !== 'match_events') return chain;
    const insert = chain.insert;
    chain.insert = vi.fn((written: SupabaseRow) => {
      rows.push({ id: `w${rows.length + 1}`, reason: null, adjustment_ms: null, ...written });
      return insert(written);
    }) as never;
    return chain;
  }) as never;
}

/** A step tapped at `pressed` and sent at 11:00, after `step` steps of round `round`. */
export const lateStep = (pressed: string, step = 0, round = 1) => ({
  ...press(pressed),
  round,
  step,
});

/** What was written, in order: the table, and the type of a timeline row. */
export const written = (db: ReturnType<typeof level>['db']) =>
  db.writes.map((write) => `${write.table} ${(write.row as { type?: string }).type ?? write.op}`);
