import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../common/testing/supabase-chain';
import { fetchHemaRatingsProfile } from '../modules/hema-ratings/hema-ratings.service';
import type * as HemaRatingsServiceModule from '../modules/hema-ratings/hema-ratings.service';
import { HemaRatingsSyncWorker } from './hema-ratings-sync.worker';

vi.mock('../modules/hema-ratings/hema-ratings.service', async (importOriginal) => ({
  ...(await importOriginal<typeof HemaRatingsServiceModule>()),
  fetchHemaRatingsProfile: vi.fn(async (id: string) => ({ id })),
}));

/**
 * The worker `process()` performs three steps:
 *   1. fetch hemaratings.com/fighters/ (the global HTML index)
 *   2. fetch one detail page per linked id (hema-ratings-linked-ids.ts: every
 *      profile's, and the roster ids of Events not yet ended)
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

function makeFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(false) } as never;
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

    const worker = new HemaRatingsSyncWorker(makeQueue(), makeSupabase([]), makeFlags());
    const job = { id: 'test-job' } as never;

    await expect(worker.process(job)).rejects.toThrow(/hemaratings\.com returned HTTP 503/);
  });

  it('rethrows when the global fetch itself throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const worker = new HemaRatingsSyncWorker(makeQueue(), makeSupabase([]), makeFlags());
    const job = { id: 'test-job' } as never;

    await expect(worker.process(job)).rejects.toThrow('ECONNRESET');
  });
});

/**
 * Which ids the night job fetches ratings for (operator ruling 41, 2026-09-22):
 * every id on a global profile, and every id typed on a roster row of an Event
 * that has not ended. The roster ids matter because an entry no longer copies
 * the typed id onto the profile (ruling 35) and seeding reads the roster first.
 */
describe('HemaRatingsSyncWorker — the ids it fetches ratings for', () => {
  beforeEach(() => vi.mocked(fetchHemaRatingsProfile).mockClear());

  it("adds the roster rows' ids of Events not yet ended, trimmed and once each", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const supabase = mockSupabase({
      global_persons: { rows: [{ hema_ratings_id: '100' }, { hema_ratings_id: null }] },
      events: {
        rows: [
          { id: 'e-past', end_date: '2000-01-01' },
          { id: 'e-today', end_date: today },
          { id: 'e-live', end_date: '2999-12-31' },
        ],
      },
      persons: {
        rows: [
          // A finished Event seeds nothing.
          { event_id: 'e-past', hema_ratings_id: '400' },
          { event_id: 'e-today', hema_ratings_id: '500' },
          { event_id: 'e-live', hema_ratings_id: '200' },
          { event_id: 'e-live', hema_ratings_id: ' 300 ' },
          // Also on a profile: fetched once.
          { event_id: 'e-live', hema_ratings_id: '100' },
          { event_id: 'e-live', hema_ratings_id: null },
        ],
      },
    });
    const worker = new HemaRatingsSyncWorker(makeQueue(), supabase as never, makeFlags());

    const profiles = await (
      worker as unknown as { fetchLinkedProfiles(): Promise<Map<string, unknown>> }
    ).fetchLinkedProfiles();

    const fetched = vi.mocked(fetchHemaRatingsProfile).mock.calls.map(([id]) => id);
    expect(fetched.sort()).toEqual(['100', '200', '300', '500']);
    expect([...profiles.keys()].sort()).toEqual(['100', '200', '300', '500']);
  });
});
