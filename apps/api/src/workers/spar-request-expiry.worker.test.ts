import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, writesTo } from '../common/testing/supabase-chain';
import {
  SPAR_REQUEST_EXPIRY_QUEUE,
  SPAR_REQUEST_EXPIRY_SWEEP,
  SparRequestExpiryWorker,
} from './spar-request-expiry.worker';

const NOW = new Date('2026-05-23T04:35:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const hoursAhead = (hours: number) => hoursAgo(-hours);

function worker(
  answer: { data: unknown; error: unknown } = { data: [{ id: 'r-1' }, { id: 'r-2' }], error: null },
  floor: Record<string, unknown> = {},
) {
  const supabase = mockSupabase({
    spar_requests: answer as never,
    fightbook_free_now: { rows: [] },
    fightbook_qr_codes: { rows: [] },
    spar_open_calls: { rows: [] },
    ...floor,
  } as never);
  const queue = { upsertJobScheduler: vi.fn(async () => undefined) };
  return { w: new SparRequestExpiryWorker(queue as never, supabase as never), supabase, queue };
}

describe('SparRequestExpiryWorker', () => {
  it('ends every request still waiting past its end as a "Not this time", and counts them', async () => {
    const { w, supabase } = worker();
    expect(await w.sweep(NOW)).toBe(2);
    const [write] = writesTo(supabase, 'spar_requests');
    expect(write?.row).toEqual({ status: 'not_this_time' });
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([['status', 'pending']]);
    expect(filtersFor(supabase.from, 'spar_requests', 'lte')).toEqual([
      ['expires_at', NOW.toISOString()],
    ]);
  });

  it('fails its job on a failed write, so the failure is reported', async () => {
    const { w } = worker({ data: null, error: { message: 'db down' } });
    await expect(w.sweep(NOW)).rejects.toThrow('db down');
  });

  it('runs hourly at :35, upserted by its id on every boot', async () => {
    const { w, queue } = worker();
    await w.onModuleInit();
    expect(SPAR_REQUEST_EXPIRY_QUEUE).toBe('spar-request-expiry');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'spar-request-expiry-hourly',
      { pattern: '35 * * * *' },
      { name: SPAR_REQUEST_EXPIRY_SWEEP, data: {} },
    );
  });

  describe('the floor tools: rows kept only while needed', () => {
    const deleted = (supabase: ReturnType<typeof worker>['supabase'], table: string) =>
      supabase.writes.filter((w) => w.table === table && w.op === 'delete');

    it('deletes free-now rows past their until, keeps one still running', async () => {
      const { w, supabase } = worker(undefined, {
        fightbook_free_now: {
          rows: [
            { id: 'fn-old', until: hoursAgo(1) },
            { id: 'fn-live', until: hoursAhead(1) },
          ],
        },
      });
      await w.sweep(NOW);
      expect(deleted(supabase, 'fightbook_free_now')).toHaveLength(1);
      expect(filtersFor(supabase.from, 'fightbook_free_now', 'lt')).toEqual([
        ['until', NOW.toISOString()],
      ]);
    });

    it('deletes QR codes past their expiry, keeps one still good', async () => {
      const { w, supabase } = worker(undefined, {
        fightbook_qr_codes: {
          rows: [
            { id: 'q-old', expires_at: hoursAgo(1) },
            { id: 'q-live', expires_at: hoursAhead(1) },
          ],
        },
      });
      await w.sweep(NOW);
      expect(deleted(supabase, 'fightbook_qr_codes')).toHaveLength(1);
      expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'lt')).toEqual([
        ['expires_at', NOW.toISOString()],
      ]);
    });

    it('deletes calls closed more than 24 hours ago, keeps one closed 23 hours ago', async () => {
      const { w, supabase } = worker(undefined, {
        spar_open_calls: {
          rows: [
            { id: 'c-old', closes_at: hoursAgo(25) },
            { id: 'c-recent', closes_at: hoursAgo(23) },
          ],
        },
      });
      await w.sweep(NOW);
      expect(deleted(supabase, 'spar_open_calls')).toHaveLength(1);
      expect(filtersFor(supabase.from, 'spar_open_calls', 'lt')).toEqual([
        ['closes_at', hoursAgo(24)],
      ]);
    });

    it('logs a failed floor delete and still runs the others, then fails the job', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { w, supabase } = worker(undefined, {
        fightbook_free_now: { data: null, error: { message: 'free-now down' } },
      });
      await expect(w.sweep(NOW)).rejects.toThrow('free-now down');
      // The codes and calls were still swept after the free-now delete failed.
      expect(deleted(supabase, 'fightbook_qr_codes')).toHaveLength(1);
      expect(deleted(supabase, 'spar_open_calls')).toHaveLength(1);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });
  });
});
