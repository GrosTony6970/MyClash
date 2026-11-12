/**
 * The seeded-table half of the Supabase double: the part that actually
 * FILTERS.
 *
 * Split from supabase-chain-internals.ts to keep both inside the 400-line
 * budget. The seam is not an interesting one — internals holds the lazy chain
 * and the write log, this holds row narrowing, ordering and counting. Import
 * the public shapes from supabase-chain.ts, which re-exports what a test needs.
 */
import { vi } from 'vitest';
import {
  buildChain,
  newQueryLog,
  nullBoundRefusal,
  unsupported,
  UNSIMULATED,
  type QueryLog,
  type SupabaseChain,
  installInsert,
  stampWritten,
  type ReadMode,
  type SeededTable,
  type SupabaseRow,
  type WriteSink,
} from './supabase-chain-internals';
import { inRange, likeRow, notInRow, orPredicate } from './supabase-chain-predicates';

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
 * Rank two rows on ONE sort key.
 *
 * Nulls sort as a block at one end, independent of the ascending flag — an
 * absent column reads as null, matching `is`. Postgres puts that block LAST
 * ascending and FIRST descending, and PostgREST's `nullsFirst` option overrides
 * it, so the resolved rule is `nullsFirst ?? !ascending`. Getting this backwards
 * would reorder a result and let a test assert the wrong row with no sign of it,
 * which is why it is spelled out rather than left to sort's own null handling.
 */
function compareOn(a: SupabaseRow, b: SupabaseRow, key: Ordering): number {
  const { column, ascending, nullsFirst } = key;
  const left = a[column] ?? null;
  const right = b[column] ?? null;
  if (left === null || right === null) {
    if (left === null && right === null) return 0;
    return (left === null ? 1 : -1) * ((nullsFirst ?? !ascending) ? -1 : 1);
  }
  return compareCells(left, right) * (ascending ? 1 : -1);
}

/**
 * Sort a seeded table the way Postgres would, on EVERY key in turn.
 *
 * `.order('a').order('b')` is one query sorted by a and tie-broken by b, not two
 * sorts where the last wins — supabase-js appends each call to a single
 * `order=a,b`. Keeping only the last key is the quiet kind of wrong: it still
 * returns a plausibly sorted list, so a fixture whose keys happen to agree
 * passes while asserting nothing about the primary one. `resolveNextMatchOnLice`
 * is why this matters here — it ranks by `status` before time, so the bout it
 * calls "next" is decided by the key a last-wins model would drop.
 *
 * Ties fall through to seed order, because `sort` is stable and PostgREST
 * likewise promises nothing beyond the keys it was given.
 */
function orderRows(rows: SupabaseRow[], keys: readonly Ordering[]): SupabaseRow[] {
  return rows.sort((a, b) => {
    for (const key of keys) {
      const verdict = compareOn(a, b, key);
      if (verdict !== 0) return verdict;
    }
    return 0;
  });
}

/**
 * A builder over a seeded table.
 *
 * Filters narrow a PER-CALL copy: `from()` hands out a fresh chain each time, so
 * one query's `.eq()` can never shrink the next one's result. Order, limit and
 * range are recorded and applied at resolution, which is the order PostgREST
 * applies them in — filters, then sort, then the page. Applying `limit` early
 * would take the first rows seeded rather than the first rows wanted.
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
  /**
   * How many rows the filters left, IGNORING limit and range. PostgREST's
   * `count: 'exact'` reports the size of the match, not the size of the page it returned.
   */
  total(): number;
  narrow(predicate: (row: SupabaseRow) => boolean): void;
  /** Appends a sort key. Each `.order()` call is a further tiebreaker. */
  orderBy(ordering: Ordering): void;
  limitTo(count: number): void;
  /**
   * `range(from, to)` as postgrest-js sends it: `offset=from` and `limit=to-from+1`.
   * `limit(n)` sets the limit only, so whichever of the two came LAST sets the
   * page size, and a range's offset stays under a later limit.
   */
  skip(offset: number): void;
}

function rowSet(seed: readonly SupabaseRow[]): RowSet {
  let working: SupabaseRow[] = [...seed];
  const orderings: Ordering[] = [];
  let cap: number | null = null;
  let offset = 0;
  return {
    current: () => {
      const out = orderings.length > 0 ? orderRows([...working], orderings) : [...working];
      return out.slice(offset, cap === null ? undefined : offset + cap);
    },
    skip: (from) => {
      offset = from;
    },
    total: () => working.length,
    narrow: (predicate) => {
      working = working.filter(predicate);
    },
    orderBy: (next) => {
      orderings.push(next);
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
/**
 * The four range comparisons, installed together because they are one rule.
 *
 * Split out of `installNarrowing` for its line budget, and it reads better
 * here anyway: `gte`/`lt` bound a half-open window, `gt`/`lte` the other half.
 */
function installRanges(
  chain: SupabaseChain,
  narrow: (
    method: string,
    args: readonly unknown[],
    predicate: (row: SupabaseRow) => boolean,
  ) => SupabaseChain,
  mode: ReadMode,
): void {
  for (const operator of ['gte', 'gt', 'lte', 'lt'] as const) {
    chain[operator] = vi.fn((c: string, v: unknown) => {
      mode.refused ??= nullBoundRefusal(operator, c, v);
      return narrow(operator, [c, v], inRange(operator, c, v));
    });
  }
}

function installNarrowing(chain: SupabaseChain, log: QueryLog, set: RowSet, mode: ReadMode): void {
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
    if (operator === 'in') return narrow('not', [c, operator, v], notInRow(c, v));
    if (operator !== 'eq') throw unsupported('not', `operator "${operator}"`);
    return narrow('not', [c, operator, v], (row) => row[c] !== v);
  });
  chain.ilike = vi.fn((c: string, p: string) => narrow('ilike', [c, p], likeRow(c, p)));
  chain.or = vi.fn((source: string) => narrow('or', [source], orPredicate(source)));
  installRanges(chain, narrow, mode);
  installPaging(chain, log, set);
}

/** `order`, `limit` and `range`: recorded now, applied at resolution after every filter. */
function installPaging(chain: SupabaseChain, log: QueryLog, set: RowSet): void {
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
  chain.range = vi.fn((from: number, to: number) => {
    log.note('range', [from, to]);
    set.skip(from);
    set.limitTo(to - from + 1);
    return chain;
  });
}

/**
 * `select(…, { count, head })` — the shape a "how many?" query takes.
 *
 * `head: true` asks for the number WITHOUT the rows, which is why a caller that
 * only wants a total does not pay for the payload. Answering it with rows and no
 * count made every such call report zero, and a fixture that reports zero for a
 * real count is the failure this module exists to avoid.
 *
 * Only `exact` is modelled. `planned` and `estimated` are Postgres statistics
 * rather than a fact about these rows, so they throw rather than return a number
 * a test would then assert on.
 */
function installSelect(chain: SupabaseChain, mode: ReadMode): void {
  chain.select = vi.fn((projection?: string, options?: { count?: string; head?: boolean }) => {
    if (options?.count !== undefined && options.count !== 'exact') {
      throw unsupported('select', `count: "${options.count}"`);
    }
    if (options?.count === 'exact') mode.counting = 'exact';
    if (options?.head) mode.headOnly = true;
    // Asking for the stored row is what turns the stamp on.
    if (mode.written) mode.representation = true;
    // Deliberately NOT logged: a projection does not scope a write, and the
    // filter log is what tells a recorded write which rows it hit.
    void projection;
    return chain;
  });
}

/** Every unmodelled filter, as a thrower rather than a silent pass-through. */
function installUnsupported(chain: SupabaseChain): void {
  for (const method of UNSIMULATED) {
    chain[method] = vi.fn(() => {
      throw unsupported(method, 'no caller has needed it yet');
    });
  }
}

export function seededTableChain(seed: SeededTable, sink: WriteSink): SupabaseChain {
  const set = rowSet(seed.rows);
  const mode: ReadMode = { counting: null, headOnly: false, written: null, representation: false };
  const rows = () =>
    mode.written && mode.representation
      ? stampWritten(mode.written, seed, set.current())
      : set.current();
  const log = newQueryLog();

  const chain = buildChain(
    () =>
      mode.refused
        ? { data: null, error: mode.refused }
        : {
            data: mode.headOnly ? null : rows(),
            error: null,
            ...(mode.counting ? { count: set.total() } : {}),
          },
    rows,
    log,
    sink,
  );

  installUnsupported(chain);
  installSelect(chain, mode);
  installNarrowing(chain, log, set, mode);
  installInsert(chain, mode);
  return chain;
}
