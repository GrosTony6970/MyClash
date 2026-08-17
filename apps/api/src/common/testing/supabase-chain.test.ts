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

// ── Seeded tables ────────────────────────────────────────────────────────────
// `{ rows }` is the shape new tests want: filters narrow it, so a test can
// assert the OUTCOME instead of asserting which filter the code asked for.

const ROWS = [
  { id: 'a', status: 'scheduled', seq: 2 },
  { id: 'b', status: 'completed', seq: 1 },
  { id: 'c', status: 'voided', seq: 3 },
];

describe('a seeded table', () => {
  it('narrows on eq, and awaiting gives what survived', async () => {
    const from = supabaseFrom({ matches: { rows: ROWS } });
    const { data } = await from('matches').select().eq('status', 'completed');
    expect(data).toEqual([{ id: 'b', status: 'completed', seq: 1 }]);
  });

  // The direct test that resolution is LAZY. This module used to settle at
  // construction, so every filter ran against an answer already fixed. Restore
  // that and this reddens while every canned test above stays green.
  it('applies a filter added after the chain was built', async () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    chain.select().in('status', ['completed', 'voided']);
    const { data } = await chain;
    expect((data as { id: string }[]).map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('does not let one query see another query filters', async () => {
    const from = supabaseFrom({ matches: { rows: ROWS } });
    await from('matches').select().eq('id', 'a');
    const { data } = await from('matches').select();
    expect(data).toHaveLength(3);
  });

  it('reads an absent column as null, the way an unset nullable one looks', async () => {
    const from = supabaseFrom({ forfeits: { rows: [{ id: 'f1' }, { id: 'f2', voided_at: 'x' }] } });
    const { data } = await from('forfeits').select().is('voided_at', null);
    expect(data).toEqual([{ id: 'f1' }]);
  });

  it('sorts then truncates, so limit takes the row wanted and not the row seeded', async () => {
    const from = supabaseFrom({ events: { rows: ROWS } });
    const { data } = await from('events').select().order('seq', { ascending: false }).limit(1);
    expect(data).toEqual([{ id: 'c', status: 'voided', seq: 3 }]);
  });

  it('gives maybeSingle the first survivor, and null when none survived', async () => {
    const from = supabaseFrom({ matches: { rows: ROWS } });
    await expect(from('matches').select().eq('id', 'b').maybeSingle()).resolves.toEqual({
      data: { id: 'b', status: 'completed', seq: 1 },
      error: null,
    });
    await expect(from('matches').select().eq('id', 'zz').maybeSingle()).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  it('gives single() PGRST116 unless exactly one row survived', async () => {
    // classify.ts documents PGRST116 as "0 or >1 rows where single() wanted
    // exactly 1", and ten production files branch on it.
    const from = supabaseFrom({ matches: { rows: ROWS } });
    await expect(from('matches').select().eq('id', 'b').single()).resolves.toEqual({
      data: { id: 'b', status: 'completed', seq: 1 },
      error: null,
    });
    for (const value of ['zz', undefined]) {
      const chain = from('matches').select();
      if (value) chain.eq('id', value);
      const { error } = await chain.single();
      expect((error as { code: string }).code).toBe('PGRST116');
    }
  });

  it('keeps select() a recording no-op, so the projection can still be asserted', async () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    const { data } = await chain.select('id, status');
    expect(data).toHaveLength(3);
    expect(chain.select.mock.calls[0]?.[0]).toBe('id, status');
  });

  it('chains writes without changing what a later read returns', async () => {
    const from = supabaseFrom({ matches: { rows: ROWS } });
    await from('matches').update({ status: 'scheduled' }).eq('id', 'b');
    const { data } = await from('matches').select();
    expect(data).toEqual(ROWS);
  });
});

describe('a seeded table refuses what it cannot model', () => {
  it('throws on a filter it does not simulate, rather than returning every row', () => {
    // Passing through would hand back the whole table and the test would assert
    // less than it appears to — the same failure an unconfigured table throws on.
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    expect(() => chain.or('id.eq.a')).toThrow(/or is not simulated/);
    expect(() => chain.gt('seq', 1)).toThrow(/gt is not simulated/);
  });

  it('throws on a not() operator other than eq', () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    expect(() => chain.not('status', 'eq', 'voided')).not.toThrow();
    expect(() => chain.not('status', 'in', ['voided'])).toThrow(/operator "in"/);
  });

  it('throws on an order option it does not model', () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    expect(() => chain.order('seq', { ascending: true, nullsFirst: true })).toThrow(
      /option "nullsFirst"/,
    );
  });

  it('throws rather than guess where a null sorts', () => {
    const chain = supabaseFrom({ matches: { rows: [{ id: 'a' }, { id: 'b', seq: 1 }] } })(
      'matches',
    );
    expect(() => chain.order('seq').limit(1).maybeSingle()).toThrow(/holds null in this fixture/);
  });

  it('still treats a bare array as a queue, never as rows', async () => {
    // A ChainResult and a table row are both plain objects, so sniffing would be
    // a guess — and a wrong guess silently changes what the test asserts.
    const from = supabaseFrom({ matches: [{ data: [{ id: 'x' }], error: null }] });
    const { data } = await from('matches').select().eq('id', 'nothing-matches-this');
    expect(data).toEqual([{ id: 'x' }]);
  });
});

// ── Recorded writes ──────────────────────────────────────────────────────────
// `{ table, row }` alone says a match row was cleared and cannot say WHICH, so a
// cascade that clears the wrong bout still satisfies it. The filters are what
// make the assertion specific.

describe('recorded writes', () => {
  it('carries the filters that scoped the write, not just the table', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service
      .from('matches')
      .update({ red_registration_id: null })
      .eq('id', 'b')
      .eq('phase_id', 'p1');

    expect(supabase.writes).toEqual([
      {
        table: 'matches',
        op: 'update',
        row: { red_registration_id: null },
        filters: [
          { method: 'eq', args: ['id', 'b'] },
          { method: 'eq', args: ['phase_id', 'p1'] },
        ],
      },
    ]);
  });

  it('records the filters even though they arrive after the verb', async () => {
    // PostgREST spells it `.update(row).eq('id', x)`. Capturing at verb time
    // would record an unscoped write and lose the only thing that names the row.
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service.from('matches').delete().eq('id', 'c');
    expect(supabase.writes[0]?.filters).toEqual([{ method: 'eq', args: ['id', 'c'] }]);
  });

  it('keeps two writes to one table apart rather than merging them', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service.from('matches').update({ status: 'scheduled' }).eq('id', 'a');
    await supabase.service.from('matches').update({ status: 'scheduled' }).eq('id', 'b');
    expect(supabase.writes.map((write) => write.filters)).toEqual([
      [{ method: 'eq', args: ['id', 'a'] }],
      [{ method: 'eq', args: ['id', 'b'] }],
    ]);
  });

  it('records nothing for a read', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service.from('matches').select().eq('id', 'a');
    expect(supabase.writes).toEqual([]);
  });

  it('records writes against a canned table too', async () => {
    const supabase = mockSupabase({ audit_log: { data: null, error: null } });
    await supabase.service.from('audit_log').insert({ kind: 'reset_match' });
    expect(supabase.writes).toEqual([
      { table: 'audit_log', op: 'insert', row: { kind: 'reset_match' }, filters: [] },
    ]);
  });

  it('does not treat the projection as a scope', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service.from('matches').update({ status: 'x' }).select('id').eq('id', 'a');
    expect(supabase.writes[0]?.filters).toEqual([{ method: 'eq', args: ['id', 'a'] }]);
  });
});
