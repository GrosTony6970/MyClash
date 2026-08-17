/**
 * The parts of the Supabase double that callers do not name.
 *
 * Split out of supabase-chain.ts to keep both files inside the 400-line budget,
 * not because the seam is interesting: import the public shapes from
 * supabase-chain.ts, which re-exports everything a test needs.
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
const NARROWING = ['eq', 'neq', 'in', 'is', 'not', 'gte', 'lt', 'order', 'limit'] as const;

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
export const notExactlyOneRow = (): ChainResult => ({
  data: null,
  error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
});

const unsupported = (method: string, detail: string): Error =>
  new Error(
    `supabaseChain: ${method} is not simulated on a seeded table (${detail}). ` +
      `Model it here, or seed this table with { data } if the filter is not what the test is about.`,
  );

/** One filter a query was scoped by, in call order. */
export interface RecordedFilter {
  method: string;
  args: readonly unknown[];
}

/**
 * A write, with the filters that decided which rows it hit.
 *
 * The filters are the point. A record of `{ table, row }` alone says a match row
 * was cleared and cannot say WHICH — so a cascade that clears the wrong bout
 * still satisfies it.
 */
export interface RecordedWrite {
  table: string;
  op: (typeof WRITES)[number];
  row: unknown;
  filters: readonly RecordedFilter[];
}

const PASS_THROUGH_SET: ReadonlySet<string> = new Set(PASS_THROUGH);
const WRITE_SET: ReadonlySet<string> = new Set(WRITES);

/** Where one chain's filters accumulate. One chain is one query. */
interface QueryLog {
  filters: RecordedFilter[];
  note(method: string, args: readonly unknown[]): void;
}

export const newQueryLog = (): QueryLog => {
  const filters: RecordedFilter[] = [];
  return { filters, note: (method, args) => filters.push({ method, args }) };
};

export type WriteSink = { table: string; writes: RecordedWrite[] } | null;

/**
 * A thenable that computes at AWAIT time.
 *
 * This module used to bind `Promise.resolve(result)` once at construction, which
 * fixes the answer before any filter can run. Filtering cannot exist on that
 * shape, so the promise is built per call instead.
 */
function lazyThenable(resolve: () => ChainResult): SupabaseChain {
  return {
    then: (onFulfilled?: ((value: ChainResult) => unknown) | null, onRejected?: unknown) =>
      Promise.resolve(resolve()).then(
        onFulfilled ?? undefined,
        (onRejected ?? undefined) as undefined,
      ),
    catch: (onRejected?: unknown) => Promise.resolve(resolve()).catch(onRejected as undefined),
    finally: (onFinally?: (() => void) | null) =>
      Promise.resolve(resolve()).finally(onFinally ?? undefined),
  } as unknown as SupabaseChain;
}

/**
 * Write verbs record when called but carry the LIVE filter array.
 *
 * PostgREST spells it `.update(row).eq('id', x)`, so the scope arrives after the
 * verb. One chain is one query, so every filter on it belongs to this write
 * whatever order the calls came in — a copy taken here would record an unscoped
 * write and lose the only thing that names the row.
 */
function installWrites(chain: SupabaseChain, log: QueryLog, sink: WriteSink): void {
  if (!sink) return;
  for (const op of WRITES) {
    chain[op] = vi.fn((row?: unknown) => {
      sink.writes.push({ table: sink.table, op, row, filters: log.filters });
      return chain;
    });
  }
}

/** The lazy core: every method chains, and nothing resolves before it is asked. */
export function buildChain(
  resolve: () => ChainResult,
  rows: (() => SupabaseRow[]) | null,
  log: QueryLog,
  sink: WriteSink,
): SupabaseChain {
  const chain = lazyThenable(resolve);

  for (const method of CHAINABLE) {
    chain[method] = vi.fn((...args: unknown[]) => {
      // A projection does not scope a write; a filter does. Writes record
      // themselves rather than as their own scope.
      if (!PASS_THROUGH_SET.has(method) && !WRITE_SET.has(method)) log.note(method, args);
      return chain;
    });
  }
  installWrites(chain, log, sink);

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
 * Compare two PRESENT cells for `order`. Nulls never reach here — where they
 * sort is decided by {@link orderRows}, because it is a property of the query,
 * not of the two values.
 */
function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Sort a seeded table the way Postgres would.
 *
 * Nulls sort as a block at one end, independent of the ascending flag — an
 * absent column reads as null, matching `is`. Postgres puts that block LAST
 * ascending and FIRST descending, and PostgREST's `nullsFirst` option overrides
 * it, so the resolved rule is `nullsFirst ?? !ascending`. Getting this backwards
 * would reorder a result and let a test assert the wrong row with no sign of it,
 * which is why it is spelled out rather than left to sort's own null handling.
 */
function orderRows(
  rows: SupabaseRow[],
  { column, ascending, nullsFirst }: Ordering,
): SupabaseRow[] {
  const nullsLead = nullsFirst ?? !ascending;
  return rows.sort((a, b) => {
    const left = a[column] ?? null;
    const right = b[column] ?? null;
    if (left === null || right === null) {
      if (left === null && right === null) return 0;
      return (left === null ? 1 : -1) * (nullsLead ? -1 : 1);
    }
    return compareCells(left, right) * (ascending ? 1 : -1);
  });
}

/**
 * Order two cells for a RANGE filter, or report that they cannot be ordered.
 *
 * Deliberately not `compareCells`, which throws on null. The two nulls mean
 * different things: a null in a sort column is a fixture that cannot express an
 * order, while a null in a filtered column is a row Postgres simply excludes —
 * `scheduled_at >= x` over NULL evaluates to NULL, which is not TRUE, so the row
 * does not come back. `assertLiceFree` writing `.not('scheduled_at','is',null)`
 * immediately before its window is the code saying it knows those rows exist.
 *
 * An ABSENT column reads the same as a null one, matching `is` above.
 *
 * Plain relational operators rather than `localeCompare`: the values reaching a
 * range filter here are ISO-8601 instants and numbers, where byte order is the
 * intended order and a locale-sensitive collation could only disagree.
 */
function rangeOrder(cell: unknown, value: unknown): number | null {
  if (cell === null || cell === undefined || value === null || value === undefined) return null;
  if (typeof cell === 'number' && typeof value === 'number') return cell - value;
  const [a, b] = [String(cell), String(value)];
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `gte` / `lt` as a row predicate. A cell that cannot be ordered is excluded. */
const inRange =
  (operator: 'gte' | 'lt', column: string, value: unknown) =>
  (row: SupabaseRow): boolean => {
    const order = rangeOrder(row[column], value);
    if (order === null) return false;
    return operator === 'gte' ? order >= 0 : order < 0;
  };

/**
 * A builder over a seeded table.
 *
 * Filters narrow a PER-CALL copy: `from()` hands out a fresh chain each time, so
 * one query's `.eq()` can never shrink the next one's result. Order and limit
 * are recorded and applied at resolution, which is the order PostgREST applies
 * them in — filters, then sort, then truncate. Applying `limit` early would take
 * the first rows seeded rather than the first rows wanted.
 */
interface Ordering {
  column: string;
  ascending: boolean;
  /** Undefined means "whatever Postgres would do", i.e. `!ascending`. */
  nullsFirst: boolean | undefined;
}

interface RowSet {
  /** What survived, sorted and truncated — computed fresh on every read. */
  current(): SupabaseRow[];
  narrow(predicate: (row: SupabaseRow) => boolean): void;
  orderBy(ordering: Ordering): void;
  limitTo(count: number): void;
}

function rowSet(seed: readonly SupabaseRow[]): RowSet {
  let working: SupabaseRow[] = [...seed];
  let ordering: Ordering | null = null;
  let cap: number | null = null;
  return {
    current: () => {
      const out = ordering ? orderRows([...working], ordering) : [...working];
      return cap === null ? out : out.slice(0, cap);
    },
    narrow: (predicate) => {
      working = working.filter(predicate);
    },
    orderBy: (next) => {
      ordering = next;
    },
    limitTo: (count) => {
      cap = count;
    },
  };
}

/**
 * The narrowing methods, over a RowSet.
 *
 * Each one LOGS as well as filters. The filters are what tell a recorded write
 * which rows it hit, so one that forgot to note itself would leave a write
 * looking unscoped while still filtering correctly — the quietest way this could
 * go wrong.
 */
function installNarrowing(chain: SupabaseChain, log: QueryLog, set: RowSet): void {
  const narrow = (
    method: string,
    args: readonly unknown[],
    predicate: (row: SupabaseRow) => boolean,
  ): SupabaseChain => {
    log.note(method, args);
    set.narrow(predicate);
    return chain;
  };

  chain.eq = vi.fn((c: string, v: unknown) => narrow('eq', [c, v], (row) => row[c] === v));
  chain.neq = vi.fn((c: string, v: unknown) => narrow('neq', [c, v], (row) => row[c] !== v));
  chain.in = vi.fn((c: string, values: readonly unknown[]) =>
    narrow('in', [c, values], (row) => values.includes(row[c])),
  );
  // A column absent from a fixture row reads as null, which is what an unset
  // nullable column actually looks like.
  chain.is = vi.fn((c: string, v: unknown) =>
    narrow('is', [c, v], (row) => (row[c] ?? null) === v),
  );
  chain.not = vi.fn((c: string, operator: string, v: unknown) => {
    if (operator === 'is') return narrow('not', [c, operator, v], (r) => (r[c] ?? null) !== v);
    if (operator !== 'eq') throw unsupported('not', `operator "${operator}"`);
    return narrow('not', [c, operator, v], (row) => row[c] !== v);
  });
  chain.gte = vi.fn((c: string, v: unknown) => narrow('gte', [c, v], inRange('gte', c, v)));
  chain.lt = vi.fn((c: string, v: unknown) => narrow('lt', [c, v], inRange('lt', c, v)));

  chain.order = vi.fn((column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
    const known = ['ascending', 'nullsFirst'];
    const extra = Object.keys(options ?? {}).filter((key) => !known.includes(key));
    if (extra.length > 0) throw unsupported('order', `option "${extra[0]}"`);
    log.note('order', [column, options]);
    set.orderBy({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    });
    return chain;
  });
  chain.limit = vi.fn((count: number) => {
    log.note('limit', [count]);
    set.limitTo(count);
    return chain;
  });
}

export function seededTableChain(seed: readonly SupabaseRow[], sink: WriteSink): SupabaseChain {
  const set = rowSet(seed);
  const rows = () => set.current();
  const log = newQueryLog();
  const chain = buildChain(() => ({ data: rows(), error: null }), rows, log, sink);

  for (const method of UNSIMULATED) {
    chain[method] = vi.fn(() => {
      throw unsupported(method, 'no caller has needed it yet');
    });
  }
  installNarrowing(chain, log, set);
  return chain;
}
