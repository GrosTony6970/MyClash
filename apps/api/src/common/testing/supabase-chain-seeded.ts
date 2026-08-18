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
import { parseOr, type OrTerm } from './supabase-chain-or';

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

/**
 * `ilike` as Postgres means it.
 *
 * The pattern is a LIKE pattern, not a substring: `%` matches any run of
 * characters, `_` matches exactly one, the comparison is case-insensitive, and
 * it is anchored at BOTH ends. Callers use all three shapes — an exact value
 * (`ilike('email', normalized)`), a prefix (`slug%`) and a contains (`%term%`)
 * — so treating this as a plain substring test would quietly widen every exact
 * one and let those tests assert less than they appear to.
 *
 * Regex metacharacters are escaped FIRST, so the dots in an email match dots
 * rather than any character.
 *
 * A non-string cell never matches. `col ILIKE x` over NULL evaluates to NULL,
 * which is not TRUE, so Postgres does not return the row.
 */
function likeMatcher(pattern: string): (cell: unknown) => boolean {
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  const expression = new RegExp(`^${source}$`, 'i');
  return (cell) => typeof cell === 'string' && expression.test(cell);
}

/** `ilike` as a row predicate, compiled once per call — the shape `inRange` uses. */
const likeRow = (column: string, pattern: string) => {
  const matches = likeMatcher(pattern);
  return (row: SupabaseRow): boolean => matches(row[column]);
};

/**
 * One sibling of an `.or()` string, as a row predicate.
 *
 * `eq`, `neq` and `in` compare the cell's TEXT, because that is what an `.or`
 * carries: PostgREST puts the value in a URL and Postgres casts it to the
 * column's type, so `id.eq.7` matches a numeric 7 the same way `.eq('id', 7)`
 * does. The chain methods keep strict equality — there the caller passed a real
 * JS value and a type mismatch is a fixture bug worth surfacing.
 *
 * An absent or null cell matches none of them. `col = 'x'` over NULL evaluates
 * to NULL, which is not TRUE, and so does `col <> 'x'` — a null row is excluded
 * by `neq` as well, which is the half people expect to be symmetric and is not.
 * `is` is the exception: it is the operator that can see a null.
 */
function orRow(term: OrTerm): (row: SupabaseRow) => boolean {
  const { column, operator, negated, value } = term;
  if (operator === 'is') {
    return (row) => ((row[column] ?? null) === value) !== negated;
  }
  if (operator === 'ilike') return likeRow(column, value as string);
  const present = (row: SupabaseRow) => (row[column] ?? null) !== null;
  if (operator === 'in') {
    const wanted = value as string[];
    return (row) => present(row) && wanted.includes(String(row[column]));
  }
  const matches = (row: SupabaseRow) => String(row[column]) === value;
  return operator === 'eq'
    ? (row) => present(row) && matches(row)
    : (row) => present(row) && !matches(row);
}

/**
 * A whole `.or()` string as one predicate.
 *
 * Siblings are ORed, so a row survives if ANY term matches. That makes this the
 * one filter that WIDENS, and the reason a seeded table cannot approximate `or`
 * by ignoring it: every other unmodelled filter left out returns too many rows,
 * and so does this one.
 */
function orPredicate(source: string): (row: SupabaseRow) => boolean {
  const terms = parseOr(source).map((term) => orRow(term));
  return (row) => terms.some((matches) => matches(row));
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
  /**
   * How many rows the filters left, IGNORING limit. PostgREST's `count: 'exact'`
   * reports the size of the match, not the size of the page it returned.
   */
  total(): number;
  narrow(predicate: (row: SupabaseRow) => boolean): void;
  /** Appends a sort key. Each `.order()` call is a further tiebreaker. */
  orderBy(ordering: Ordering): void;
  limitTo(count: number): void;
}

function rowSet(seed: readonly SupabaseRow[]): RowSet {
  let working: SupabaseRow[] = [...seed];
  const orderings: Ordering[] = [];
  let cap: number | null = null;
  return {
    current: () => {
      const out = orderings.length > 0 ? orderRows([...working], orderings) : [...working];
      return cap === null ? out : out.slice(0, cap);
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
  chain.ilike = vi.fn((c: string, p: string) => narrow('ilike', [c, p], likeRow(c, p)));
  chain.or = vi.fn((source: string) => narrow('or', [source], orPredicate(source)));
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
    () => ({
      data: mode.headOnly ? null : rows(),
      error: null,
      ...(mode.counting ? { count: set.total() } : {}),
    }),
    rows,
    log,
    sink,
  );

  installUnsupported(chain);
  installSelect(chain, mode);
  installNarrowing(chain, log, set);
  installInsert(chain, mode);
  return chain;
}
