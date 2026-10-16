import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { BOUT, NOW, RUNNING, press, row, setup } from './clock-late-press.fixtures';

/**
 * A row another tablet writes while a late press is judged (S11).
 *
 * A tablet's Halt of 10:05 reaches the server at 11:00. Its rules read the clock running; just
 * after that read, the desk's own Halt lands, at 11:00. The late Halt took the next sequence at
 * its insert, and was written as a second Halt, past every rule that judged it. It takes its
 * sequence BEFORE the reads that judge it: the desk's Halt takes that sequence first, the insert
 * collides, and every rule is asked again. The clock is halted: the press is done.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The desk's Halt lands just after the first read of the timeline by time: the read of the clock
 * that judges the press. The timeline keeps its unique key on (bout, sequence), as the database.
 */
function deskHaltsMeanwhile(db: ReturnType<typeof setup>['db'], rows: SupabaseRow[]) {
  const deskHalt = row(2, 'halt', '11:00:00');
  let landed = false;
  const real = db.service.from;
  db.service.from = vi.fn((table: string) => {
    const chain = real(table);
    if (table !== 'match_events') return chain;
    const order = chain.order;
    chain.order = vi.fn((column: string, options?: { ascending?: boolean }) => {
      if (column === 'occurred_at' && !landed) {
        landed = true;
        rows.push(deskHalt);
      }
      return order(column, options);
    }) as never;
    const insert = chain.insert;
    chain.insert = vi.fn((written: { sequence: number }) => {
      if (rows.some((held) => held['sequence'] === written.sequence)) {
        return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } });
      }
      rows.push(written as SupabaseRow);
      return insert(written);
    }) as never;
    return chain;
  }) as never;
}

describe('ClockService.latePress — another tablet writes while the press is judged', () => {
  it('asks every rule again, and writes no second Halt', async () => {
    const { db, rows, clock } = setup(RUNNING);
    deskHaltsMeanwhile(db, rows);

    const answer = await clock.latePress(BOUT, 'halt', press('10:05:00'), {
      staffAccountId: 'staff-1',
    });

    expect(answer.status).toBe('halted');
    expect(writesTo(db, 'match_events')).toEqual([]);
  });
});
