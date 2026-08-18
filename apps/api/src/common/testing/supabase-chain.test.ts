import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  supabaseChain,
  supabaseFrom,
  writesTo,
} from './supabase-chain';

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

  it('gives maybeSingle the one survivor, and null when none survived', async () => {
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

  /**
   * maybeSingle is "nought or one", not "the first one". Returning row zero on
   * a match of two is the quiet kind of wrong: it hands back a plausible row
   * where PostgREST hands back an error, so a filter that does not narrow reads
   * exactly like one that does. It also hides a real production failure —
   * hasAdminAccess takes .limit(1) precisely because a user in two
   * organizations nulled a maybeSingle and read as a member of none.
   */
  it('gives maybeSingle PGRST116 when more than one row survived', async () => {
    const { data, error } = await supabaseFrom({ matches: { rows: ROWS } })('matches')
      .select()
      .maybeSingle();
    expect(data).toBeNull();
    expect((error as { code: string }).code).toBe('PGRST116');
  });

  /**
   * `insert(…).select()` is the one read a fixture cannot answer from its rows:
   * the row did not exist a moment ago, and the id belongs to the database.
   * Echoing what was written would hand back `undefined` for that id, and four
   * sites in match-forfeits alone key their next write on it.
   */
  const LEDGER = {
    forfeits: {
      rows: [{ id: 'old-1', match_id: 'match-9' }],
      returning: (row: Record<string, unknown>, index: number) => ({
        id: `new-${index + 1}`,
        ...row,
      }),
    },
  } as const;

  it('returns the stored row for an insert that asks for it back', async () => {
    const { data } = await supabaseFrom(LEDGER)('forfeits')
      .insert({ match_id: 'match-1' })
      .select('*')
      .single();
    // The caller's column AND the id only the database could supply — not the
    // rows already in the table, which is what an unfiltered read would give.
    expect(data).toEqual({ id: 'new-1', match_id: 'match-1' });
  });

  it('stamps each row of a multi-row insert by its position', async () => {
    const { data } = await supabaseFrom(LEDGER)('forfeits')
      .insert([{ match_id: 'a' }, { match_id: 'b' }])
      .select('*');
    expect(data).toEqual([
      { id: 'new-1', match_id: 'a' },
      { id: 'new-2', match_id: 'b' },
    ]);
  });

  it('leaves a bare insert resolving the way it always did', async () => {
    // No select(), so PostgREST returns no representation and the caller only
    // reads `error`. Many call sites spell it this way, and the point here is
    // that asking for the stored row is what turns the stamp on — an insert
    // that never asked must not start answering with what it wrote.
    const { data, error } = await supabaseFrom(LEDGER)('forfeits').insert({ match_id: 'match-1' });
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'old-1', match_id: 'match-9' }]);
  });

  it('still reads the seeded rows when the query is not a write', async () => {
    const { data } = await supabaseFrom(LEDGER)('forfeits').select('*').eq('id', 'old-1');
    expect(data).toEqual([{ id: 'old-1', match_id: 'match-9' }]);
  });

  /**
   * `returning` is purely ADDITIVE. Without it the read-back resolves from the
   * fixture exactly as it always did — the older idiom, "seed the row the write
   * reads back" — and some fixtures depend on the empty case: a bracket seed
   * returns no slots on purpose, so the placeholder-match path never runs.
   */
  it('resolves an undeclared read-back from the fixture, as it always did', async () => {
    const held = await supabaseFrom({ forfeits: { rows: [{ id: 'seeded-1' }] } })('forfeits')
      .insert({ match_id: 'match-1' })
      .select('*');
    expect(held.data).toEqual([{ id: 'seeded-1' }]);

    const empty = await supabaseFrom({ forfeits: { rows: [] } })('forfeits')
      .insert({ match_id: 'match-1' })
      .select('*');
    expect(empty.data).toEqual([]);
  });

  it('returns the rows an update matched, which is what UPDATE … RETURNING gives', async () => {
    // No `returning` needed: the rows that satisfy the filter ARE the rows the
    // update touched, so the fixture already holds the answer.
    const { data } = await supabaseFrom({ matches: { rows: ROWS } })('matches')
      .update({ status: 'voided' })
      .eq('id', 'b')
      .select('id');
    expect(data).toEqual([{ id: 'b', status: 'completed', seq: 1 }]);
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
    expect(() => chain.contains('tags', ['x'])).toThrow(/contains is not simulated/);
    expect(() => chain.gt('seq', 1)).toThrow(/gt is not simulated/);
  });

  it('throws on a not() operator other than eq', () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    expect(() => chain.not('status', 'eq', 'voided')).not.toThrow();
    expect(() => chain.not('status', 'in', ['voided'])).toThrow(/operator "in"/);
  });

  /**
   * `ilike` is a LIKE pattern, not a substring test, and 25 call sites across
   * eleven modules rely on the difference: most pass an exact value, a few pass
   * `prefix%`, a few pass `%term%`. Matching on substring would silently widen
   * every exact one — which is how an email lookup starts matching the wrong
   * person while its test still passes.
   */
  const NAMES = {
    global_persons: {
      rows: [
        { id: 'a', email: 'Fighter@Example.com', name: 'Lyon AMHE' },
        { id: 'b', email: 'other@example.com', name: 'Paris HEMA' },
        { id: 'c', email: null, name: 'Club de Lyon' },
        // Differs from `a` only where the dot is, so an unescaped pattern
        // matches both and an escaped one matches neither but `a`.
        { id: 'd', email: 'fighter@exampleXcom', name: 'Nowhere' },
      ],
    },
  } as const;
  const idsFrom = (data: unknown) => (data as Array<{ id: string }>).map((r) => r.id);

  it('matches ilike case-insensitively and anchored, not as a substring', async () => {
    const from = supabaseFrom(NAMES);
    const exact = await from('global_persons').select().ilike('email', 'fighter@example.com');
    expect(idsFrom(exact.data)).toEqual(['a']);

    // 'example.com' is a substring of both emails but an ILIKE match for neither.
    const substring = await from('global_persons').select().ilike('email', 'example.com');
    expect(idsFrom(substring.data)).toEqual([]);
  });

  it('treats % as any run and _ as exactly one character', async () => {
    const from = supabaseFrom(NAMES);
    const contains = await from('global_persons').select().ilike('name', '%lyon%');
    expect(idsFrom(contains.data)).toEqual(['a', 'c']);

    const prefix = await from('global_persons').select().ilike('name', 'Lyon%');
    expect(idsFrom(prefix.data)).toEqual(['a']);

    const single = await from('global_persons').select().ilike('id', '_');
    expect(idsFrom(single.data)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads a dot in the pattern literally rather than as any character', async () => {
    // `d` differs from `a` only at the dot. Leaving the regex escape out turns
    // every email lookup into a wildcard, which is how a login matches the
    // wrong account while its test still reads as passing.
    const { data } = await supabaseFrom(NAMES)('global_persons')
      .select()
      .ilike('email', 'fighter@example.com');
    expect(idsFrom(data)).toEqual(['a']);
  });

  it('never matches a null cell, because ILIKE over NULL is not TRUE', async () => {
    const { data } = await supabaseFrom(NAMES)('global_persons').select().ilike('email', '%');
    expect(idsFrom(data)).toEqual(['a', 'b', 'd']);
  });

  /**
   * `.or()` is the only filter that WIDENS, and seventeen call sites in eleven
   * modules build one. A seeded table that refused it forced each of those
   * reads to stay canned, which dropped every other filter in the same query to
   * an argument assertion.
   */
  const BOUTS = {
    matches: {
      rows: [
        { id: 'a', red: 'r1', blue: 'b1', seq: 2, voided_at: null },
        { id: 'b', red: 'r2', blue: 'r1', seq: 10, voided_at: '2026-01-01' },
        { id: 'c', red: 'r3', blue: 'b3', seq: 3 },
      ],
    },
  } as const;

  it('keeps a row that matches ANY sibling, not every one', async () => {
    // 'a' matches only the red term and 'b' only the blue one. An AND here
    // returns nothing at all; ignoring the filter returns 'c' as well.
    const { data } = await supabaseFrom(BOUTS)('matches').select().or('red.eq.r1,blue.eq.r1');
    expect(idsFrom(data)).toEqual(['a', 'b']);
  });

  it('reads a comma inside in.(…) as a value, not as a sibling separator', async () => {
    // Splitting on every comma makes this four terms — three unparseable, and
    // the one that parses narrows on half the list.
    const { data } = await supabaseFrom(BOUTS)('matches')
      .select()
      .or('red.in.(r1,r3),blue.in.(nobody)');
    expect(idsFrom(data)).toEqual(['a', 'c']);
  });

  it('matches an ilike sibling as a LIKE pattern', async () => {
    const { data } = await supabaseFrom(BOUTS)('matches').select().or('red.ilike.R_,blue.ilike.b1');
    expect(idsFrom(data)).toEqual(['a', 'b', 'c']);
  });

  it('sees a null cell through is, and only through is', async () => {
    const from = supabaseFrom(BOUTS);
    // 'c' has no voided_at column at all, which reads the same as null.
    const nulls = await from('matches').select().or('voided_at.is.null');
    expect(idsFrom(nulls.data)).toEqual(['a', 'c']);

    const present = await from('matches').select().or('voided_at.not.is.null');
    expect(idsFrom(present.data)).toEqual(['b']);

    // `col <> 'x'` over NULL is NULL, which is not TRUE — the half of
    // three-valued logic people expect to be symmetric and is not.
    const other = await from('matches').select().or('voided_at.neq.2026-06-06');
    expect(idsFrom(other.data)).toEqual(['b']);

    // And `col = 'null'` is a comparison against the four-letter word, which no
    // null row satisfies. Without the guard String(null) makes every one match.
    const word = await from('matches').select().or('voided_at.eq.null');
    expect(idsFrom(word.data)).toEqual([]);
  });

  it('compares the cell as text, because an or value arrives as text', async () => {
    // `.eq('seq', 10)` is given a real number; '10' comes out of a URL. Strict
    // equality here would match nothing and read as a filter that simply found
    // no rows.
    const { data } = await supabaseFrom(BOUTS)('matches').select().or('seq.eq.10');
    expect(idsFrom(data)).toEqual(['b']);
  });

  it('throws on an or shape it does not model, rather than widening', () => {
    const chain = () => supabaseFrom(BOUTS)('matches').select();
    expect(() => chain().or('is_system.eq.true,and(a.eq.1,b.eq.2)')).toThrow(/nested and\(\)/);
    expect(() => chain().or('code.like.x%')).toThrow(/operator "like"/);
    expect(() => chain().or('seq.gte.2')).toThrow(/operator "gte"/);
    expect(() => chain().or('red.not.eq.r1')).toThrow(/not\.eq/);
    expect(() => chain().or('voided_at.is.unknown')).toThrow(/is\."unknown"/);
    expect(() => chain().or('red.in.r1')).toThrow(/in without a \(list\)/);
    expect(() => chain().or('')).toThrow(/an empty filter string/);
  });

  it('throws on an order option it does not model', () => {
    const chain = supabaseFrom({ matches: { rows: ROWS } })('matches');
    expect(() => chain.order('seq', { ascending: true, descending: true })).toThrow(
      /option "descending"/,
    );
  });

  // Postgres sorts nulls LAST ascending and FIRST descending; `nullsFirst`
  // overrides that. A fixture with a null in the sorted column is the common
  // case, not an exotic one — `events.start_date` on a draft is null, and the
  // picker orders on it.
  const NULL_SORT = { matches: { rows: [{ id: 'a' }, { id: 'b', seq: 1 }] } } as const;

  it('sorts nulls last when ascending, the Postgres default', async () => {
    const { data } = await supabaseFrom(NULL_SORT)('matches').select().order('seq');
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts nulls first when descending, the Postgres default', async () => {
    const { data } = await supabaseFrom(NULL_SORT)('matches')
      .select()
      .order('seq', { ascending: false });
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('lets nullsFirst override the default in both directions', async () => {
    const from = supabaseFrom(NULL_SORT);
    const asc = await from('matches').select().order('seq', { nullsFirst: true });
    expect((asc.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['a', 'b']);

    const desc = await from('matches')
      .select()
      .order('seq', { ascending: false, nullsFirst: false });
    expect((desc.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['b', 'a']);
  });

  // `.order('a').order('b')` is ONE sort by a, tie-broken by b — supabase-js
  // appends each call to a single `order=a,b`. Keeping only the last key still
  // returns a plausibly sorted list, which is why it needs pinning: a fixture
  // whose two keys happen to agree would pass either way.
  const TIED = {
    matches: {
      rows: [
        { id: 'late-a', slot: 2, label: 'A' },
        { id: 'early-b', slot: 1, label: 'B' },
        { id: 'early-a', slot: 1, label: 'A' },
      ],
    },
  } as const;

  it('sorts on the first order key and breaks ties with the second', async () => {
    const { data } = await supabaseFrom(TIED)('matches').select().order('slot').order('label');
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual([
      'early-a',
      'early-b',
      'late-a',
    ]);
  });

  it('does not let a later key outrank an earlier one', async () => {
    // Reversed against the test above: if the last call won, `label` would put
    // both A rows in front and this would read the same as sorting by label.
    const { data } = await supabaseFrom(TIED)('matches').select().order('label').order('slot');
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual([
      'early-a',
      'late-a',
      'early-b',
    ]);
  });

  it('applies ascending and nullsFirst per key rather than globally', async () => {
    // The null lands INSIDE the second group rather than at the end of the
    // whole list, which is the difference between ranking by both keys and
    // ranking by the last one: dropping `grp` here would read p, q, r.
    const { data } = await supabaseFrom({
      matches: {
        rows: [
          { id: 'p', grp: 1, at: '2026-05-05T09:00:00Z' },
          { id: 'q', grp: 2, at: '2026-05-05T10:00:00Z' },
          { id: 'r', grp: 2 },
        ],
      },
    })('matches')
      .select()
      .order('grp', { ascending: false })
      .order('at', { ascending: true, nullsFirst: false });
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual(['q', 'r', 'p']);
  });

  it('treats an absent column the same as an explicit null, matching is()', async () => {
    const { data } = await supabaseFrom({
      matches: { rows: [{ id: 'a', seq: null }, { id: 'b', seq: 2 }, { id: 'c' }] },
    })('matches')
      .select()
      .order('seq', { nullsFirst: true });
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids.slice(0, 2).sort()).toEqual(['a', 'c']);
    expect(ids[2]).toBe('b');
  });

  // `select('id', { count: 'exact', head: true })` is how this codebase counts:
  // PostgREST aggregates are disabled on the deployment, so a total arrives as a
  // count with no rows. A fixture that answered zero to those would report an
  // empty event as a full one, and vice versa.
  const COUNTABLE = {
    matches: {
      rows: [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'completed' },
        { id: 'c', status: 'voided' },
      ],
    },
  } as const;

  it('counts what the filters left, and returns no rows for a head query', async () => {
    const res = await supabaseFrom(COUNTABLE)('matches')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');

    expect(res.count).toBe(2);
    expect(res.data).toBeNull();
  });

  it('counts the whole match, not the page a limit returned', async () => {
    // PostgREST's exact count reports the size of the match; the limit only
    // truncates the payload. Counting after the limit would report 1 of 1.
    const res = await supabaseFrom(COUNTABLE)('matches')
      .select('id', { count: 'exact' })
      .eq('status', 'completed')
      .limit(1);

    expect(res.count).toBe(2);
    expect(res.data).toHaveLength(1);
  });

  it('leaves count absent when the query did not ask for one', async () => {
    const res = await supabaseFrom(COUNTABLE)('matches').select('id');

    expect(res.count).toBeUndefined();
    expect(res.data).toHaveLength(3);
  });

  it('throws on a count mode it cannot answer honestly', () => {
    // `planned` and `estimated` are Postgres statistics, not a fact about these
    // rows. Returning a number for them would be inventing one.
    const chain = supabaseFrom(COUNTABLE)('matches');
    expect(() => chain.select('id', { count: 'planned' })).toThrow(/count: "planned"/);
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

// ── Range filters and the null check ─────────────────────────────────────────
// The day window a bulk clear erases with, and the null check that runs before
// a piste-occupancy read. Kept together because the two nulls behave DIFFERENTLY
// on purpose: a null in a SORT column throws, because a fixture cannot express
// where it belongs; a null in a FILTERED column is excluded, because Postgres
// evaluates `col >= x` over NULL to NULL, and NULL is not TRUE.

const DAY_START = '2026-05-02T00:00:00.000Z';
const NEXT_DAY = '2026-05-03T00:00:00.000Z';
const DAY = {
  before: { id: 'before', scheduled_at: '2026-05-01T23:59:59.999Z' },
  start: { id: 'start', scheduled_at: DAY_START },
  inside: { id: 'inside', scheduled_at: '2026-05-02T10:30:00.000Z' },
  end: { id: 'end', scheduled_at: NEXT_DAY },
  unscheduled: { id: 'unscheduled', scheduled_at: null },
  absent: { id: 'absent' },
};
const DAY_ROWS = Object.values(DAY);
const idsOf = (data: unknown) => (data as Array<{ id: string }>).map((row) => row.id);

describe('a seeded table filters a range', () => {
  it('keeps the row ON the gte boundary and drops the one below it', async () => {
    const from = supabaseFrom({ matches: { rows: DAY_ROWS } });
    const { data } = await from('matches').select().gte('scheduled_at', DAY_START);
    expect(idsOf(data)).toEqual(['start', 'inside', 'end']);
  });

  it('drops the row ON the lt boundary and keeps the one below it', async () => {
    const from = supabaseFrom({ matches: { rows: DAY_ROWS } });
    const { data } = await from('matches').select().lt('scheduled_at', NEXT_DAY);
    expect(idsOf(data)).toEqual(['before', 'start', 'inside']);
  });

  it('models one local day as a half-open window', async () => {
    const from = supabaseFrom({ matches: { rows: DAY_ROWS } });
    const { data } = await from('matches')
      .select()
      .gte('scheduled_at', DAY_START)
      .lt('scheduled_at', NEXT_DAY);
    expect(idsOf(data)).toEqual(['start', 'inside']);
  });

  it('excludes a null or absent cell instead of throwing the way order does', async () => {
    const from = supabaseFrom({ matches: { rows: [DAY.unscheduled, DAY.absent, DAY.inside] } });
    const { data } = await from('matches').select().gte('scheduled_at', '1970-01-01T00:00:00.000Z');
    expect(idsOf(data)).toEqual(['inside']);
  });

  it('orders numbers as numbers rather than as text', async () => {
    // '9' sorts after '10' as text, so a sequence column would filter backwards.
    const from = supabaseFrom({
      exchanges: {
        rows: [
          { id: 'ninth', sequence: 9 },
          { id: 'tenth', sequence: 10 },
        ],
      },
    });
    const { data } = await from('exchanges').select().gte('sequence', 10);
    expect(idsOf(data)).toEqual(['tenth']);
  });

  it('records the window a write was scoped to, not only the table', async () => {
    const supabase = mockSupabase({ matches: { rows: DAY_ROWS } });
    await supabase.service
      .from('matches')
      .update({ scheduled_at: null })
      .gte('scheduled_at', DAY_START)
      .lt('scheduled_at', NEXT_DAY)
      .select('id');
    expect(supabase.writes[0]?.filters).toEqual([
      { method: 'gte', args: ['scheduled_at', DAY_START] },
      { method: 'lt', args: ['scheduled_at', NEXT_DAY] },
    ]);
  });
});

describe('not(column, is, value)', () => {
  it('keeps rows holding a value and drops null and absent ones', async () => {
    const from = supabaseFrom({ matches: { rows: [DAY.unscheduled, DAY.absent, DAY.inside] } });
    const { data } = await from('matches').select().not('scheduled_at', 'is', null);
    expect(idsOf(data)).toEqual(['inside']);
  });

  it('reads a non-null operand too', async () => {
    const from = supabaseFrom({
      matches: {
        rows: [
          { id: 'gone', status: 'voided' },
          { id: 'live', status: 'scheduled' },
        ],
      },
    });
    const { data } = await from('matches').select().not('status', 'is', 'voided');
    expect(idsOf(data)).toEqual(['live']);
  });

  it('still refuses an operator it does not model', () => {
    const chain = supabaseFrom({ matches: { rows: DAY_ROWS } })('matches');
    expect(() => chain.not('scheduled_at', 'gt', 1)).toThrow(/operator "gt"/);
  });
});

// ── Assertion helpers ────────────────────────────────────────────────────────

describe('writesTo / scopedTo', () => {
  it('picks one table out of a cascade and names the row a write hit', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS }, exchanges: { rows: [] } });
    await supabase.service.from('exchanges').update({ voided: true }).eq('match_id', 'a');
    await supabase.service.from('matches').update({ status: 'scheduled' }).eq('id', 'c');

    expect(writesTo(supabase, 'matches')).toHaveLength(1);
    expect(scopedTo(writesTo(supabase, 'matches')[0], 'id')).toBe('c');
    expect(scopedTo(writesTo(supabase, 'exchanges')[0], 'match_id')).toBe('a');
  });

  it('reports an unscoped write as undefined rather than guessing', async () => {
    const supabase = mockSupabase({ matches: { rows: ROWS } });
    await supabase.service.from('matches').update({ status: 'scheduled' });
    expect(scopedTo(writesTo(supabase, 'matches')[0], 'id')).toBeUndefined();
  });
});

describe('selectsFor', () => {
  it('collects one table projections and ignores another table', async () => {
    const from = supabaseFrom({ matches: { rows: ROWS }, exchanges: { rows: [] } });
    await from('matches').select('id, status');
    await from('exchanges').select('sequence');
    expect(selectsFor(from, 'matches')).toEqual(['id, status']);
    expect(selectsFor(from, 'exchanges')).toEqual(['sequence']);
  });

  it('is not fooled by the order the tables were queried in', async () => {
    // The index-based spelling reads results[0] and gets whichever table
    // happened to go first. Inserting a query upstream would silently move it.
    const from = supabaseFrom({ matches: { rows: ROWS }, exchanges: { rows: [] } });
    await from('exchanges').select('sequence');
    await from('matches').select('id, status');
    expect(selectsFor(from, 'matches')).toEqual(['id, status']);
  });

  it('skips a call that threw, so the real failure is not buried', () => {
    const from = supabaseFrom({ matches: { rows: ROWS } });
    from('matches').select('id');
    expect(() => from('phases')).toThrow(/unconfigured table/);
    expect(selectsFor(from, 'matches')).toEqual(['id']);
    expect(selectsFor(from, 'phases')).toEqual([]);
  });
});
