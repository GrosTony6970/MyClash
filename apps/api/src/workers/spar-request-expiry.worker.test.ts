import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, writesTo } from '../common/testing/supabase-chain';
import {
  SPAR_REQUEST_EXPIRY_QUEUE,
  SPAR_REQUEST_EXPIRY_SWEEP,
  SparRequestExpiryWorker,
} from './spar-request-expiry.worker';

const NOW = new Date('2026-05-23T04:35:00Z');

function worker(
  answer: { data: unknown; error: unknown } = { data: [{ id: 'r-1' }, { id: 'r-2' }], error: null },
) {
  const supabase = mockSupabase({ spar_requests: answer as never });
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
});
