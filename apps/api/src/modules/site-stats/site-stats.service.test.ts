import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteStatsService } from './site-stats.service';

/**
 * The mock is keyed by TABLE NAME, not by call order.
 *
 * getPublicStats issues its three counts inside a Promise.all, so an
 * order-keyed queue of mockReturnValueOnce would still pass if two counts
 * swapped — the test would be asserting the shape of its own fixture rather
 * than the behaviour. Keying by table means "clubs came back as the fighter
 * count" fails loudly.
 */

type CountResult = { count: number | null; error: unknown };

interface Recorded {
  table: string;
  eq: [string, unknown][];
  neq: [string, unknown][];
  in: [string, readonly unknown[]][];
  head: boolean;
}

function makeSupabase(results: Record<string, CountResult | (() => never)>) {
  const calls: Recorded[] = [];

  const from = vi.fn((table: string) => {
    const outcome = results[table];
    const recorded: Recorded = { table, eq: [], neq: [], in: [], head: false };
    calls.push(recorded);

    if (typeof outcome === 'function') {
      // Simulates the client throwing rather than resolving with an error.
      return {
        select: () => {
          outcome();
        },
      };
    }

    const chain = Object.assign(Promise.resolve(outcome ?? { count: 0, error: null }), {
      select: vi.fn((_columns: string, options?: { count?: string; head?: boolean }) => {
        recorded.head = options?.head === true;
        return chain;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        recorded.eq.push([column, value]);
        return chain;
      }),
      neq: vi.fn((column: string, value: unknown) => {
        recorded.neq.push([column, value]);
        return chain;
      }),
      in: vi.fn((column: string, values: readonly unknown[]) => {
        recorded.in.push([column, values]);
        return chain;
      }),
    });
    return chain;
  });

  return { supabase: { service: { from } }, calls };
}

describe('SiteStatsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports one count per table, mapped to the right field', async () => {
    const { supabase } = makeSupabase({
      events: { count: 7, error: null },
      clubs: { count: 12, error: null },
      global_persons: { count: 214, error: null },
    });

    const stats = await new SiteStatsService(supabase as never).getPublicStats();

    expect(stats).toEqual({ events: 7, clubs: 12, fighters: 214 });
  });

  it('counts only events a visitor could actually see', async () => {
    /*
     * The predicate has to match `listEvents` in events.service.ts. If it
     * drifts, the landing page advertises a number of events that does not
     * match the list it links to — and draft or test events would be counted as
     * public adoption.
     */
    const { supabase, calls } = makeSupabase({
      events: { count: 7, error: null },
      clubs: { count: 0, error: null },
      global_persons: { count: 0, error: null },
    });

    await new SiteStatsService(supabase as never).getPublicStats();

    const events = calls.find((call) => call.table === 'events');
    expect(events?.in).toEqual([['status', ['published', 'running', 'completed']]]);
    expect(events?.neq).toEqual([['event_kind', 'test']]);
  });

  it('counts fighters, not every identity on the platform', async () => {
    const { supabase, calls } = makeSupabase({
      events: { count: 0, error: null },
      clubs: { count: 0, error: null },
      global_persons: { count: 214, error: null },
    });

    await new SiteStatsService(supabase as never).getPublicStats();

    const people = calls.find((call) => call.table === 'global_persons');
    expect(people?.eq).toEqual([['is_fighter', true]]);
  });

  it('asks for a count without fetching rows', async () => {
    // `head: true` is what keeps this from pulling every row of global_persons
    // on a page that anyone on the internet can load.
    const { supabase, calls } = makeSupabase({
      events: { count: 1, error: null },
      clubs: { count: 1, error: null },
      global_persons: { count: 1, error: null },
    });

    await new SiteStatsService(supabase as never).getPublicStats();

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.head)).toBe(true);
  });

  it('reports 0 for a failed count rather than guessing', async () => {
    /*
     * 0 is load-bearing, not a fallback value: the marketing page renders no
     * stats band at all when a count is 0. A query that fails therefore removes
     * the section instead of publishing a number nobody can substantiate —
     * which is the whole reason these counts stopped being hardcoded.
     */
    const { supabase } = makeSupabase({
      events: { count: null, error: { message: 'relation does not exist' } },
      clubs: { count: 12, error: null },
      global_persons: { count: 214, error: null },
    });

    const stats = await new SiteStatsService(supabase as never).getPublicStats();

    expect(stats).toEqual({ events: 0, clubs: 12, fighters: 214 });
  });

  it('survives the client throwing', async () => {
    const { supabase } = makeSupabase({
      events: () => {
        throw new Error('connection reset');
      },
      clubs: { count: 12, error: null },
      global_persons: { count: 214, error: null },
    });

    const stats = await new SiteStatsService(supabase as never).getPublicStats();

    expect(stats).toEqual({ events: 0, clubs: 12, fighters: 214 });
  });

  it('treats a null count as 0', async () => {
    const { supabase } = makeSupabase({
      events: { count: null, error: null },
      clubs: { count: null, error: null },
      global_persons: { count: null, error: null },
    });

    const stats = await new SiteStatsService(supabase as never).getPublicStats();

    expect(stats).toEqual({ events: 0, clubs: 0, fighters: 0 });
  });
});
