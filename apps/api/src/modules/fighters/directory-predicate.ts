/**
 * Which global_persons rows a public fighter read may return.
 *
 * This was previously answered nowhere. `list()` applied no predicate at all,
 * `getBySlug()` matched on slug alone, and the fuzzy search's hydrate step
 * re-fetched by id without re-applying the RPC's own filters — so the same
 * conceptual query returned a different row set depending on how long the
 * search term was, and merged-away and erased identities came back from both.
 *
 * One definition, in two forms that must agree: a predicate for rows already in
 * memory, and the PostgREST filter chain that selects the same set. They live
 * beside each other so they cannot drift.
 *
 * ── Reachable ───────────────────────────────────────────────────────────────
 * The profile exists as a live identity. Excludes:
 *  - `deleted_at` — merged away into another identity (0012).
 *  - `merged_into_id` — the same event, seen from the other side.
 *  - `account_deleted_at` — GDPR erasure (0161).
 *
 * It deliberately does NOT require a claim, `is_fighter`, or any directory
 * listing. Profiles are linked from club rosters and follow lists, and the
 * overwhelming majority of the population was imported from a CSV by an
 * organiser and has never claimed anything: gating reachability on those would
 * 404 most of the platform. It would also contradict what the forthcoming
 * listing toggle promises — opting out removes you from the directory and from
 * search, it does not hide results you already fought for.
 *
 * The narrower directory and indexing predicates build on this one; they arrive
 * with the columns they read.
 */

export interface ReachableRow {
  deleted_at?: string | null;
  merged_into_id?: string | null;
  account_deleted_at?: string | null;
}

/** Columns `isReachable` reads. A caller checking in memory must select these. */
export const REACHABLE_COLUMNS = ['deleted_at', 'merged_into_id', 'account_deleted_at'] as const;

/** A live identity: not merged away, not erased. */
export function isReachable(row: ReachableRow): boolean {
  return row.deleted_at == null && row.merged_into_id == null && row.account_deleted_at == null;
}

/**
 * The PostgREST filter chain matching `isReachable`.
 *
 * A read that hydrates rows by id — the fuzzy search does — has to apply this
 * itself. The id list it was handed is not a promise about the rows behind it,
 * and the RPC that produced it filters on only two of the three.
 */
export function applyReachable<T extends { is(column: string, value: null): T }>(query: T): T {
  return query.is('deleted_at', null).is('merged_into_id', null).is('account_deleted_at', null);
}
