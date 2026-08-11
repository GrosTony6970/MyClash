/**
 * Is this PostgREST error a defect, or ordinary flow?
 *
 * The tripwire is worthless if it cries wolf. `.single()` with no rows and a
 * unique violation on a retry path are both normal here — `23505` alone has
 * eight benign call sites — so they are recorded at `warning` and the operator
 * surface leads with `error`.
 *
 * WHAT THIS EXISTS TO CATCH, and why it is not already covered:
 * `db-schema-conformance.test.ts` already resolves ~5,500 (table, column) pairs
 * offline and kills undefined columns and tables before they ship. But its own
 * header calls it DELIBERATELY COWARDLY: it skips every select string carrying
 * `(`, `:`, `!` or `.`, which is every EMBED. So `PGRST200` and `PGRST201` —
 * relationship-not-found and ambiguous-embed — are invisible to it, as are the
 * `.rpc()` sites, `.from(variable)`, and everything data-dependent. That
 * residual is this module's territory.
 */

/**
 * How seriously to take an error.
 *
 * `error`   — the query is wrong. It cannot succeed for any input.
 * `warning` — the query is fine; this input or this moment was not.
 */
export type QueryErrorSeverity = 'error' | 'warning';

/**
 * Codes that mean the query itself is malformed against the live schema.
 *
 * PGRST200/201 are the load-bearing entries: they are the class the offline
 * schema scan provably cannot see.
 */
const CONTRACT_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  'PGRST100', // failed to parse the query string
  'PGRST200', // requested relationship not found in the schema cache
  'PGRST201', // ambiguous embed — more than one relationship matched
  'PGRST202', // function not found in the schema cache
]);

/**
 * Codes that a correct query can legitimately produce, given the wrong data,
 * the wrong caller, or a race.
 */
const RUNTIME_CODES = new Set([
  'PGRST116', // 0 or >1 rows where single() wanted exactly 1
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '42501', // insufficient_privilege — an RLS denial
]);

/**
 * Postgres classes that mean the database was under pressure, not that the
 * query was wrong. These arrive as 5xx and must NOT be filed as contract
 * defects: a statement timeout says nothing about the SQL's correctness.
 */
const OPERATIONAL_CODES = new Set([
  '57014', // query_canceled — statement_timeout
  '53300', // too_many_connections
  '53200', // out_of_memory
  '55P03', // lock_not_available
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '08006', // connection_failure
]);

export type QueryErrorClass = 'contract' | 'runtime' | 'operational';

/**
 * Bucket an error by its code, falling back to the status.
 *
 * An UNRECOGNISED code is `contract` on purpose — fail loud. A new PostgREST
 * version inventing a code should surface for triage, not vanish into a bucket
 * nobody reads. `classify.test.ts` asserts the three sets are disjoint, so a
 * code can never be quietly claimed by two of them.
 */
export function classifyQueryError(code: string | null, status: number): QueryErrorClass {
  if (code) {
    if (OPERATIONAL_CODES.has(code)) return 'operational';
    if (RUNTIME_CODES.has(code)) return 'runtime';
    if (CONTRACT_CODES.has(code)) return 'contract';
  }

  // No code at all: a proxy or gateway answered, not PostgREST. 502/503/504
  // from Traefik carry HTML and mean the database tier is unreachable — an
  // operational fact, and never evidence that the query was malformed.
  if (!code && status >= 500) return 'operational';

  return 'contract';
}

/** Only contract defects are loud; the rest are context. */
export function severityFor(errorClass: QueryErrorClass): QueryErrorSeverity {
  return errorClass === 'contract' ? 'error' : 'warning';
}

/** Exported for the disjointness test, which is the guard on this whole file. */
export const QUERY_ERROR_CODE_SETS = {
  contract: CONTRACT_CODES,
  runtime: RUNTIME_CODES,
  operational: OPERATIONAL_CODES,
} as const;
