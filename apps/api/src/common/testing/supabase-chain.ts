/**
 * A PostgREST query-builder double for unit tests.
 *
 * Forty-two test files declare their own local `makeChain`, in thirty-five
 * genuinely different shapes. This is not (yet) a replacement for all of them —
 * each encodes real assumptions about which methods are terminal and which are
 * thenable, and rewriting them wholesale would risk silently weakening
 * assertions. It is the shape new tests should reach for.
 *
 * The reason it exists is not deduplication. It is that the prevailing idiom —
 * `from.mockReturnValueOnce(a).mockReturnValueOnce(b)` — is ORDER-DEPENDENT.
 * Insert a query anywhere upstream and every later result shifts by one; the
 * suite stays green while asserting against the wrong table. That desync is a
 * known defect class here (see the ordered sequences in matches.service tests).
 *
 * Routing by TABLE NAME removes the coupling: a new query on a different table
 * cannot shift anyone else's result, and a query against a table the test never
 * configured throws instead of quietly resolving to `{ data: null }` — which
 * would otherwise read as a passing "not found" branch.
 *
 * ── Two kinds of seed ───────────────────────────────────────────────────────
 * `{ table: { data } }` is CANNED: it resolves to exactly that, whatever the
 * query filters on. `{ table: { rows: [...] } }` is a SIMULATED TABLE: filters
 * narrow it, `order`/`limit` apply, and the terminals see what survived.
 *
 * New tests want `rows`. Canned is the legacy form, kept because eighteen files
 * depend on it and because a filter-free answer is still the right fixture for a
 * query whose filters are not what the test is about. Nothing infers one from
 * the other: a bare array stays a QUEUE, never rows, because a ChainResult and a
 * table row are both plain objects and a table may legitimately have a column
 * called `data`.
 *
 * ── Why resolution is lazy ──────────────────────────────────────────────────
 * This module used to settle at construction — `Promise.resolve(result)` bound
 * once, every terminal closed over the same value. Filtering cannot exist on
 * that shape: the answer is fixed before a single filter runs. So the chain now
 * computes at await time and at terminal-call time. Canned seeds resolve to the
 * identical value they always did; that equivalence is what
 * supabase-chain.test.ts pins hardest, because it is the whole regression
 * surface for the files already using this.
 *
 * Note this module holds no table or column literals on purpose:
 * everything is a parameter. `db-schema-conformance.test.ts` scans this
 * directory (its `scanApiSources` skips only *.test.ts), so a literal
 * `.from('x').select('a')` here would enter the real (table, column) assertions.
 *
 * Test-only, and excluded from apps/api/tsconfig.build.json — but NOT covered by
 * the root eslint config's test-file relaxations, whose `**\/test\/**\/*.ts` glob
 * wants a directory named `test`, not `testing`. So this file is held to
 * production lint rules: no `any`.
 */
import { vi, type Mock } from 'vitest';

import {
  buildChain,
  newQueryLog,
  seededTableChain,
  type ChainResult,
  type RecordedWrite,
  type SeededTable,
  type SupabaseChain,
  type SupabaseRow,
  type TableSeed,
} from './supabase-chain-internals';

export type {
  ChainResult,
  RecordedFilter,
  RecordedWrite,
  SeededTable,
  SupabaseChain,
  SupabaseRow,
  TableSeed,
} from './supabase-chain-internals';

/**
 * One query builder resolving to `result`, whatever it is asked.
 *
 * Thenable as well as chainable, because both spellings appear in this codebase:
 * `await sb.from(t).select().eq(...)` and `await sb.from(t).select().single()`.
 */
export function supabaseChain(
  result: ChainResult = { data: null, error: null },
  sink: { table: string; writes: RecordedWrite[] } | null = null,
): SupabaseChain {
  return buildChain(() => result, null, newQueryLog(), sink);
}

const isSeededTable = (seed: TableSeed): seed is SeededTable =>
  !Array.isArray(seed) && 'rows' in seed && Array.isArray((seed as SeededTable).rows);

/**
 * A `from()` mock that routes by table name.
 *
 * A bare `ChainResult` answers every call on that table. An ARRAY is a queue,
 * for the case where one table is queried repeatedly with different answers
 * (a loop, or a read-then-write pair); the last entry repeats once the queue is
 * down to one, so `[a]` and `a` mean the same thing. A `{ rows }` seed answers
 * every call from the same rows, which is what a table read from several call
 * sites needs — a queue there would have to predict the order they interleave.
 *
 * Querying an unconfigured table throws. Silence there is the failure mode this
 * whole module exists to avoid.
 */
export function supabaseFrom(
  byTable: Readonly<Record<string, TableSeed>>,
  writes: RecordedWrite[] = [],
): Mock<(table: string) => SupabaseChain> {
  const tables = new Map<string, readonly SupabaseRow[]>();
  const queues = new Map<string, ChainResult[]>();
  for (const [table, seed] of Object.entries(byTable)) {
    if (isSeededTable(seed)) tables.set(table, seed.rows);
    else queues.set(table, Array.isArray(seed) ? [...seed] : [seed]);
  }

  return vi.fn((table: string): SupabaseChain => {
    const sink = { table, writes };
    const seeded = tables.get(table);
    if (seeded) return seededTableChain(seeded, sink);

    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      const configured = [...tables.keys(), ...queues.keys()].sort().join(', ') || '(none)';
      throw new Error(
        `supabaseFrom: query against unconfigured table "${table}". Configured: ${configured}.`,
      );
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return supabaseChain(next, sink);
  });
}

/**
 * A stand-in for SupabaseService. Cast at the call site:
 * `new Thing(mockSupabase({ phases: { data: [] } }) as unknown as SupabaseService)`.
 *
 * `writes` collects every insert/update/upsert/delete in call order, each with
 * the filters that scoped it — so an assertion can name the row a cascade
 * touched rather than only the table. Recorded for canned and seeded tables
 * alike; a fixture is not changed by a write either way.
 */
export function mockSupabase(byTable: Readonly<Record<string, TableSeed>>): {
  service: { from: Mock<(table: string) => SupabaseChain> };
  from: Mock<(table: string) => SupabaseChain>;
  writes: RecordedWrite[];
} {
  const writes: RecordedWrite[] = [];
  const from = supabaseFrom(byTable, writes);
  return { service: { from }, from, writes };
}

/** Tables a `from()` mock was actually asked for, in call order. */
export function queriedTables(from: Mock<(table: string) => SupabaseChain>): string[] {
  return from.mock.calls.map(([table]) => table);
}

/** Writes to `table`, in call order. */
export const writesTo = (supabase: { writes: RecordedWrite[] }, table: string): RecordedWrite[] =>
  supabase.writes.filter((write) => write.table === table);

/** The value an `.eq(column, …)` scoped a write to, or undefined if unscoped. */
export const scopedTo = (write: RecordedWrite | undefined, column: string): unknown =>
  write?.filters.find((filter) => filter.method === 'eq' && filter.args[0] === column)?.args[1];

/**
 * Every projection string asked of `table`, in call order.
 *
 * Routed by TABLE, not by index. The obvious spelling —
 * `from.mock.results[2].value.select.mock.calls[0][0]` — is order-dependent in
 * exactly the way this module exists to remove: insert a query upstream and the
 * assertion silently reads a different table's projection.
 *
 * Worth having at all because the double ignores the projection, so a value-only
 * assertion stays green with the column deleted from the read. That is how a
 * column can sit missing from a select for years under a passing suite.
 *
 * Results whose `type` is not `'return'` are skipped: `from()` THROWS on an
 * unconfigured table, and reading `.select` off the recorded Error would bury
 * that failure under a TypeError.
 */
export function selectsFor(from: Mock<(table: string) => SupabaseChain>, table: string): string[] {
  return from.mock.calls.flatMap(([queried], index) => {
    const call = from.mock.results[index];
    if (queried !== table || call?.type !== 'return') return [];
    return call.value.select.mock.calls.map((args) => args[0] as string);
  });
}

/**
 * Every argument list `method` was called with on `table`, in call order.
 *
 * The companion to {@link selectsFor}, routed by table for the same reason, and
 * needed for the same kind of query: one that carries a filter the seeded double
 * refuses to model — `ilike` is the case — so the whole read has to stay canned
 * and its scope can only be asserted by argument.
 *
 * Prefer an outcome wherever the fixture can express one. This says the query
 * ASKED for something, not that the answer depended on it.
 */
export function filtersFor(
  from: Mock<(table: string) => SupabaseChain>,
  table: string,
  method: 'eq' | 'neq' | 'in' | 'is' | 'not' | 'ilike' | 'gte' | 'lt',
): unknown[][] {
  return from.mock.calls.flatMap(([queried], index) => {
    const call = from.mock.results[index];
    if (queried !== table || call?.type !== 'return') return [];
    return (call.value[method].mock.calls ?? []) as unknown[][];
  });
}
