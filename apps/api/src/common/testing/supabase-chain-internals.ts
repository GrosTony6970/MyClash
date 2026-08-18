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
const NARROWING = ['eq', 'neq', 'in', 'is', 'not', 'gte', 'lt', 'ilike', 'order', 'limit'] as const;

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
export const UNSIMULATED = [
  'gt',
  'lte',
  'like',
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

export const unsupported = (method: string, detail: string): Error =>
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
export interface QueryLog {
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
