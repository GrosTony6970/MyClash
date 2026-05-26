/**
 * Helpers for safely interpolating user-supplied search terms into
 * PostgREST filter strings (`.or()`, `.filter()`).
 *
 * Background:
 *   PostgREST's `.or(...)` argument is parsed as a comma-separated list of
 *   sibling filter expressions. Each expression is `column.operator.value`.
 *   When user input is interpolated directly into an `ilike` pattern —
 *   e.g. `.or(\`given_name.ilike.%${q}%\`)` — a `,` or `(` in the query
 *   string lets the user inject a sibling filter. They can't drop tables
 *   (the FROM clause is still bound), but they can broaden the WHERE clause
 *   to return rows the original query did not intend to expose.
 *
 * Fix: strip the four meta-characters that have special meaning in PostgREST
 * filter syntax — `,`, `(`, `)`, and `*` — and the backslash escape.
 * Anything else (letters, digits, spaces, hyphens, apostrophes, ASCII and
 * Unicode accented letters, `%`, `_`) passes through unchanged so the
 * legitimate ilike wildcards `%` and `_` still work as expected.
 */
export function sanitizePostgrestFilterValue(value: string): string {
  return value.replace(/[,()*\\]/g, '').trim();
}
