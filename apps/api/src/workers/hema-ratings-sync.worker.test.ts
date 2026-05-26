import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HemaRatingsSyncWorker } from './hema-ratings-sync.worker';

/**
 * The worker `process()` performs three steps:
 *   1. fetch hemaratings.com/fighters/ (the global HTML index)
 *   2. fetch one detail page per linked global_persons row
 *   3. insert a row into `hema_ratings_snapshots`
 *
 * The test below mocks `global fetch` to fail on the first step so we can
 * assert the worker rethrows (rather than silently swallows) — that's what
 * the BullMQ retry pipeline relies on.
 */

function makeSupabase(linkedIds: string[]) {
  const linkedChain = {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockResolvedValue({
      data: linkedIds.map((id) => ({ hema_ratings_id: id })),
      error: null,
    }),
  };
  const insertChain = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const from = vi.fn((table: string) => {
    if (table === 'global_persons') return linkedChain;
    if (table === 'hema_ratings_snapshots') return insertChain;
    throw new Error(`Unexpected supabase table: ${table}`);
  });
  return { service: { from } } as never;
}

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) } as never;
}

describe('HemaRatingsSyncWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rethrows when hemaratings.com responds with a non-2xx status so BullMQ can retry', async () => {
    // Simulate hemaratings.com returning 503.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve(''),
      }),
    );

    const worker = new HemaRatingsSyncWorker(makeQueue(), makeSupabase([]));
    const job = { id: 'test-job' } as never;

    await expect(worker.process(job)).rejects.toThrow(/hemaratings\.com returned HTTP 503/);
  });

  it('rethrows when the global fetch itself throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const worker = new HemaRatingsSyncWorker(makeQueue(), makeSupabase([]));
    const job = { id: 'test-job' } as never;

    await expect(worker.process(job)).rejects.toThrow('ECONNRESET');
  });
});
