/**
 * The terminal ordering key, compared by CODE POINT rather than by locale.
 *
 * `localeCompare` with no locale argument uses whatever the runtime's default
 * is, so the same rows could order differently on a developer's machine and in
 * the API container: `'Ähtäri'.localeCompare('Zoe')` is -1 under `en` and +1
 * under `sv`. Code points have no ICU data behind them at all, so they cannot
 * drift with a Node upgrade either.
 *
 * The cost is that accented names sort after `Z` and capitals before lowercase,
 * which is ugly to read. That is confined to rows level on EVERY declared key,
 * where the order is presentation rather than placement.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * There were two private copies of this — one in `standings.ts`, one in
 * `league-scoring.ts` — and `standings.ts` claimed in prose to be using "the
 * same helper as the League's `compareRankings`". It was not; they were two
 * functions that merely agreed. A shared rule with a docstring asserting it is
 * shared, and no import to make that true, is the failure this package spent
 * six slices removing everywhere else.
 */
export function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
