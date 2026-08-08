import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, supabaseChain, supabaseFrom } from './supabase-chain';

describe('supabaseChain', () => {
  it('returns itself from every filter, so chain length does not matter', async () => {
    const chain = supabaseChain({ data: [{ id: 'a' }], error: null });
    const result = await chain.select('id').eq('x', 1).order('y').limit(3);
    expect(result).toEqual({ data: [{ id: 'a' }], error: null });
  });

  it('resolves the same result through single() and maybeSingle()', async () => {
    const chain = supabaseChain({ data: { id: 'a' }, error: null });
    await expect(chain.select().single()).resolves.toEqual({ data: { id: 'a' }, error: null });
    await expect(chain.select().maybeSingle()).resolves.toEqual({ data: { id: 'a' }, error: null });
  });

  it('is awaitable directly, for queries with no terminal call', async () => {
    await expect(supabaseChain({ data: [], error: null })).resolves.toEqual({
      data: [],
      error: null,
    });
  });

  it('records the arguments it was called with', async () => {
    const chain = supabaseChain();
    await chain.select('id, name').eq('tournament_id', 't1');
    expect(chain.select).toHaveBeenCalledWith('id, name');
    expect(chain.eq).toHaveBeenCalledWith('tournament_id', 't1');
  });
});

describe('supabaseFrom', () => {
  it('routes by table name rather than call order', async () => {
    const from = supabaseFrom({
      phases: { data: [{ id: 'p1' }], error: null },
      matches: { data: [{ id: 'm1' }], error: null },
    });
    // Deliberately queried in the opposite order to the declaration: with the
    // mockReturnValueOnce idiom this is exactly where results silently swap.
    await expect(from('matches').select()).resolves.toEqual({ data: [{ id: 'm1' }], error: null });
    await expect(from('phases').select()).resolves.toEqual({ data: [{ id: 'p1' }], error: null });
  });

  it('walks a queue when one table is read repeatedly', async () => {
    const from = supabaseFrom({
      matches: [
        { data: [{ id: 'first' }], error: null },
        { data: [{ id: 'second' }], error: null },
      ],
    });
    await expect(from('matches').select()).resolves.toEqual({
      data: [{ id: 'first' }],
      error: null,
    });
    await expect(from('matches').select()).resolves.toEqual({
      data: [{ id: 'second' }],
      error: null,
    });
  });

  it('repeats the last queued result instead of running dry', async () => {
    const from = supabaseFrom({ matches: [{ data: [], error: null }] });
    await expect(from('matches').select()).resolves.toEqual({ data: [], error: null });
    await expect(from('matches').select()).resolves.toEqual({ data: [], error: null });
  });

  it('throws on an unconfigured table rather than resolving to null', () => {
    // The whole point. A silent `{ data: null }` reads as a passing "not found"
    // branch, so a service that starts querying a new table would keep the
    // suite green while testing nothing.
    const from = supabaseFrom({ phases: { data: [], error: null } });
    expect(() => from('matches')).toThrow(/unconfigured table "matches".*Configured: phases/s);
  });
});

describe('mockSupabase', () => {
  it('exposes the router under .service.from, as SupabaseService does', async () => {
    const supabase = mockSupabase({ phases: { data: [{ id: 'p1' }], error: null } });
    await expect(supabase.service.from('phases').select().maybeSingle()).resolves.toEqual({
      data: [{ id: 'p1' }],
      error: null,
    });
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });
});
