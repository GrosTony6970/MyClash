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

/** What a PostgREST call resolves to. */
export interface ChainResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

/** One row of a simulated table. */
export type SupabaseRow = Record<string, unknown>;

/**
 * A seeded table the double filters, rather than a canned answer.
 *
 * The key is `rows` and it is required. Sniffing an array for row-shaped
 * objects would be a guess, and a wrong guess here silently changes what a test
 * asserts.
 */
export interface SeededTable {
  rows: readonly SupabaseRow[];
}

/** Everything a table may be configured with. */
export type TableSeed = ChainResult | ChainResult[] | SeededTable;

/**
 * Chain methods that narrow, sort or truncate a seeded table.
 *
 * Deliberately short. Every entry is here because a module under test calls it;
 * see UNSIMULATED for why the rest throw rather than pass through.
 */
const NARROWING = ['eq', 'neq', 'in', 'is', 'not', 'order', 'limit'] as const;

/** Chain methods that describe the query without changing which rows come back. */
const PASS_THROUGH = ['select', 'returns', 'throwOnError', 'abortSignal'] as const;

/**
 * Write verbs. They chain, and they do not change what a later read of the same
 * table returns — a seeded table is a fixture, not a database.
 */
const WRITES = ['insert', 'update', 'upsert', 'delete'] as const;

/**
 * Filters this module does not model.
 *
 * On a canned seed they chain and are ignored, exactly as before. On a SEEDED
 * TABLE they throw, because the alternative is returning every row and letting
 * the test assert less than it appears to — the same failure that makes an
 * unconfigured table throw rather than resolve to null. Implement one when a
 * caller needs it; do not make it quietly pass.
 */
const UNSIMULATED = [
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'contains',
  'overlaps',
  'or',
  'filter',
  'match',
  'range',
] as const;

/** Filters and modifiers — each returns the builder, so chains nest freely. */
const CHAINABLE = [...PASS_THROUGH, ...WRITES, ...NARROWING, ...UNSIMULATED] as const;

/** Methods that resolve rather than chain. */
const TERMINAL = ['single', 'maybeSingle', 'csv'] as const;

type ChainMethod = (typeof CHAINABLE)[number] | (typeof TERMINAL)[number];

export type SupabaseChain = Record<ChainMethod, Mock> & PromiseLike<ChainResult>;

/** PostgREST's answer when `single()` did not find exactly one row. */
const notExactlyOneRow = (): ChainResult => ({
  data: null,
  error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
});

const unsupported = (method: string, detail: string): Error =>
  new Error(
    `supabaseChain: ${method} is not simulated on a seeded table (${detail}). ` +
      `Model it here, or seed this table with { data } if the filter is not what the test is about.`,
  );

/**
 * The lazy core. `resolve` runs at await time and at every terminal call, so a
 * filter applied after construction still counts.
 */
function buildChain(resolve: () => ChainResult, rows: (() => SupabaseRow[]) | null): SupabaseChain {
  const chain = {
    then: (onFulfilled?: ((value: ChainResult) => unknown) | null, onRejected?: unknown) =>
      Promise.resolve(resolve()).then(
        onFulfilled ?? undefined,
        (onRejected ?? undefined) as undefined,
      ),
    catch: (onRejected?: unknown) => Promise.resolve(resolve()).catch(onRejected as undefined),
    finally: (onFinally?: (() => void) | null) =>
      Promise.resolve(resolve()).finally(onFinally ?? undefined),
  } as unknown as SupabaseChain;

  for (const method of CHAINABLE) chain[method] = vi.fn(() => chain);

  if (!rows) {
    for (const method of TERMINAL) chain[method] = vi.fn(() => Promise.resolve(resolve()));
    return chain;
  }

  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: rows()[0] ?? null, error: null }));
  chain.single = vi.fn(() => {
    const found = rows();
    return Promise.resolve(
      found.length === 1 ? { data: found[0], error: null } : notExactlyOneRow(),
    );
  });
  chain.csv = vi.fn(() => {
    throw unsupported('csv', 'it would have to render rows as text');
  });
  return chain;
}

/**
 * One query builder resolving to `result`, whatever it is asked.
 *
 * Thenable as well as chainable, because both spellings appear in this codebase:
 * `await sb.from(t).select().eq(...)` and `await sb.from(t).select().single()`.
 */
export function supabaseChain(result: ChainResult = { data: null, error: null }): SupabaseChain {
  return buildChain(() => result, null);
}

/**
 * Compare two cells for `order`.
 *
 * A null or absent value THROWS rather than sorting somewhere. Postgres orders
 * nulls last ascending and first descending; guessing that wrong would reorder a
 * result and let a test assert the wrong row with no sign of it. A fixture that
 * needs null ordering should say so and this should learn it.
 */
function compareCells(a: unknown, b: unknown, column: string): number {
  if (a === null || a === undefined || b === null || b === undefined) {
    throw unsupported('order', `column "${column}" holds null in this fixture`);
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * A builder over a seeded table.
 *
 * Filters narrow a PER-CALL copy: `from()` hands out a fresh chain each time, so
 * one query's `.eq()` can never shrink the next one's result. Order and limit
 * are recorded and applied at resolution, which is the order PostgREST applies
 * them in — filters, then sort, then truncate. Applying `limit` early would take
 * the first rows seeded rather than the first rows wanted.
 */
function seededTableChain(seed: readonly SupabaseRow[]): SupabaseChain {
  let working: SupabaseRow[] = [...seed];
  let ordering: { column: string; ascending: boolean } | null = null;
  let cap: number | null = null;

  const rows = (): SupabaseRow[] => {
    const out = [...working];
    if (ordering) {
      const { column, ascending } = ordering;
      out.sort((a, b) => compareCells(a[column], b[column], column) * (ascending ? 1 : -1));
    }
    return cap === null ? out : out.slice(0, cap);
  };

  const chain = buildChain(() => ({ data: rows(), error: null }), rows);

  for (const method of UNSIMULATED) {
    chain[method] = vi.fn(() => {
      throw unsupported(method, 'no caller has needed it yet');
    });
  }

  const narrow = (predicate: (row: SupabaseRow) => boolean): SupabaseChain => {
    working = working.filter(predicate);
    return chain;
  };

  chain.eq = vi.fn((column: string, value: unknown) => narrow((row) => row[column] === value));
  chain.neq = vi.fn((column: string, value: unknown) => narrow((row) => row[column] !== value));
  chain.in = vi.fn((column: string, values: readonly unknown[]) =>
    narrow((row) => values.includes(row[column])),
  );
  // A column absent from a fixture row reads as null, which is what an unset
  // nullable column actually looks like.
  chain.is = vi.fn((column: string, value: unknown) =>
    narrow((row) => (row[column] ?? null) === value),
  );
  chain.not = vi.fn((column: string, operator: string, value: unknown) => {
    if (operator !== 'eq') throw unsupported('not', `operator "${operator}"`);
    return narrow((row) => row[column] !== value);
  });

  chain.order = vi.fn((column: string, options?: { ascending?: boolean }) => {
    const extra = Object.keys(options ?? {}).filter((key) => key !== 'ascending');
    if (extra.length > 0) throw unsupported('order', `option "${extra[0]}"`);
    ordering = { column, ascending: options?.ascending ?? true };
    return chain;
  });
  chain.limit = vi.fn((count: number) => {
    cap = count;
    return chain;
  });

  return chain;
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
): Mock<(table: string) => SupabaseChain> {
  const tables = new Map<string, readonly SupabaseRow[]>();
  const queues = new Map<string, ChainResult[]>();
  for (const [table, seed] of Object.entries(byTable)) {
    if (isSeededTable(seed)) tables.set(table, seed.rows);
    else queues.set(table, Array.isArray(seed) ? [...seed] : [seed]);
  }

  return vi.fn((table: string): SupabaseChain => {
    const seeded = tables.get(table);
    if (seeded) return seededTableChain(seeded);

    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      const configured = [...tables.keys(), ...queues.keys()].sort().join(', ') || '(none)';
      throw new Error(
        `supabaseFrom: query against unconfigured table "${table}". Configured: ${configured}.`,
      );
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return supabaseChain(next);
  });
}

/**
 * A stand-in for SupabaseService. Cast at the call site:
 * `new Thing(mockSupabase({ phases: { data: [] } }) as unknown as SupabaseService)`.
 */
export function mockSupabase(byTable: Readonly<Record<string, TableSeed>>): {
  service: { from: Mock<(table: string) => SupabaseChain> };
  from: Mock<(table: string) => SupabaseChain>;
} {
  const from = supabaseFrom(byTable);
  return { service: { from }, from };
}

/** Tables a `from()` mock was actually asked for, in call order. */
export function queriedTables(from: Mock<(table: string) => SupabaseChain>): string[] {
  return from.mock.calls.map(([table]) => table);
}
