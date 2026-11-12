/**
 * The seeded table's filters, as row predicates: what each PostgREST filter keeps.
 *
 * Split from supabase-chain-seeded.ts to keep both inside the 400-line budget.
 * The seam is a real one: this file decides WHICH rows a filter keeps, the
 * seeded chain decides when a filter runs and in what order the rest applies.
 * The `.or()` grammar lives in supabase-chain-or.ts.
 */
import type { SupabaseRow } from './supabase-chain-internals';
import { inList, parseOr, type OrTerm } from './supabase-chain-or';

/**
 * Order two cells for a RANGE filter, or report that they cannot be ordered.
 *
 * Deliberately not `compareCells`, which throws on null. The two nulls mean
 * different things: a null in a sort column is a fixture that cannot express an
 * order, while a null in a filtered column is a row Postgres simply excludes —
 * `scheduled_at >= x` over NULL evaluates to NULL, which is not TRUE, so the row
 * does not come back. `MatchPlacementService.readOccupants` writing `.not('scheduled_at','is',null)`
 * immediately before its window is the code saying it knows those rows exist.
 *
 * An ABSENT column reads the same as a null one, matching the seeded chain's `is`.
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
export const likeRow = (column: string, pattern: string) => {
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
export function orPredicate(source: string): (row: SupabaseRow) => boolean {
  const terms = parseOr(source).map((term) => orRow(term));
  return (row) => terms.some((matches) => matches(row));
}

/**
 * `.not(column, 'in', '(a,b)')` as a row predicate.
 *
 * The value must be the parenthesised STRING. postgrest-js sends `not.in.${value}`
 * as given, so an array arrives as `not.in.a,b`, without its brackets, and
 * PostgREST refuses the request: the double throws on that too, rather than
 * excluding what production never would. Values compare as text, as in an `.or`
 * list, because they travel in the URL the same way.
 *
 * A null or absent cell is excluded: `col NOT IN (…)` over NULL is NULL, not TRUE.
 */
export function notInRow(column: string, value: unknown): (row: SupabaseRow) => boolean {
  if (typeof value !== 'string') {
    throw new Error(
      `supabaseChain: not("${column}", "in", …) takes the string "(a,b)". postgrest-js sends ` +
        `an array without its brackets, and PostgREST refuses the request.`,
    );
  }
  const excluded = inList(`${column}.not.in.${value}`, value);
  return (row) => (row[column] ?? null) !== null && !excluded.includes(String(row[column]));
}

/**
 * The four range comparisons as a row predicate.
 *
 * A cell that cannot be ordered against the value is EXCLUDED rather than
 * guessed at, which is also how a NULL behaves in Postgres: every comparison
 * against NULL is NULL, and a WHERE that is NULL does not select the row.
 */
export const inRange =
  (operator: RangeOperator, column: string, value: unknown) =>
  (row: SupabaseRow): boolean => {
    const order = rangeOrder(row[column], value);
    if (order === null) return false;
    if (operator === 'gte') return order >= 0;
    if (operator === 'gt') return order > 0;
    if (operator === 'lte') return order <= 0;
    return order < 0;
  };

export type RangeOperator = 'gte' | 'gt' | 'lte' | 'lt';
