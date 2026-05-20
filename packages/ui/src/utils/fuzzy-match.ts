/**
 * Token-substring matcher used by the admin list pages for live filtering.
 *
 * Approach:
 *   • NFD-decompose + strip combining diacritics + lowercase both sides so
 *     "Lyon" matches "lyón" and "AMHE" matches "amhe".
 *   • Split the query on whitespace into tokens; every token must appear as
 *     a substring of the haystack. Token order doesn't matter — "lyon amhe"
 *     matches "AMHE Lyon".
 *   • Empty query → match everything.
 */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function fuzzyMatch(query: string, haystack: string): boolean {
  const normalizedQuery = normalizeForSearch(query).trim();
  if (!normalizedQuery) return true;
  const normalizedHaystack = normalizeForSearch(haystack);
  const tokens = normalizedQuery.split(/\s+/u);
  return tokens.every((token) => normalizedHaystack.includes(token));
}
