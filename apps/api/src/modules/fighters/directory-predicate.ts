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
 * ── Listed, and Indexable ────────────────────────────────────────────────────
 * Two narrower questions, NESTED inside reachability and inside each other:
 *
 *     isIndexable  ⊂  isListed  ⊂  isReachable
 *
 * so it is not expressible for a fighter to be indexed but unlisted — an orphan
 * page reachable only from a search result, with no route to it from the site —
 * or listed but not reachable. The database enforces the same nesting with a
 * CHECK (0187); this is the same rule where the application can see it.
 *
 * One definition each, because every surface downstream needs the SAME answer:
 * the directory, the sitemap and the per-profile robots tag are three places a
 * person's opt-out has to hold, and a surface that invents its own rule is a
 * surface where their opt-out silently does not apply.
 */

export interface ReachableRow {
  deleted_at?: string | null;
  merged_into_id?: string | null;
  account_deleted_at?: string | null;
}

export interface DirectoryRow extends ReachableRow {
  is_fighter?: boolean | null;
  claimed_by_user_id?: string | null;
  listed_in_directory?: boolean | null;
  search_indexable?: boolean | null;
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

/** Columns `isListed` and `isIndexable` read, on top of REACHABLE_COLUMNS. */
export const DIRECTORY_COLUMNS = [
  'is_fighter',
  'claimed_by_user_id',
  'listed_in_directory',
  'search_indexable',
] as const;

/**
 * Appears in the public fighter directory.
 *
 *  - `is_fighter` — it is a directory OF fighters. Referees and instructors get
 *    their own; until then they are simply not in this one.
 *  - `claimed_by_user_id` — somebody who never signed up cannot have agreed to
 *    anything. This is the requirement carrying the weight, and it is why
 *    `listed_in_directory` can default TRUE without publishing the imported
 *    majority who never chose.
 *  - `listed_in_directory` — the switch itself.
 */
export function isListed(row: DirectoryRow): boolean {
  return (
    isReachable(row) &&
    row.is_fighter === true &&
    row.claimed_by_user_id != null &&
    row.listed_in_directory === true
  );
}

/**
 * Search engines may index the profile.
 *
 * Defaults FALSE in the schema: this is the half that cannot be undone, since
 * de-indexing is slow and never reaches caches or scrapers.
 */
export function isIndexable(row: DirectoryRow): boolean {
  return isListed(row) && row.search_indexable === true;
}

/** The PostgREST filter chain matching `isListed`. */
export function applyListed<
  T extends {
    is(column: string, value: null): T;
    not(column: string, op: 'is', value: null): T;
    eq(column: string, value: boolean): T;
  },
>(query: T): T {
  return applyReachable(query)
    .eq('is_fighter', true)
    .eq('listed_in_directory', true)
    .not('claimed_by_user_id', 'is', null);
}
