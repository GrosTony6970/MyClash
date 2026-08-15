/**
 * "This bout has been fought", as one predicate.
 *
 * Sibling of `unplayed-match-columns.ts`, and the other half of the same
 * question: that module says which columns a never-played bout carries, this one
 * says how to recognise a played one.
 *
 * `started_at` matters as much as `status`. A bout that was started and then
 * reset sits at `status='scheduled'` with `started_at` still set — the clock
 * ran, exchanges may exist, and `unplayedMatchColumns` deliberately does NOT
 * clear the schedule placement. Reading status alone calls that bout untouched.
 *
 * It was spelled twice, in two files, with nothing saying which spelling was
 * right:
 *
 *   bracket-dependents.ts   `fought(status, startedAt)`
 *   bracket-match-sync.ts   `hasStarted(match)`, off `match.started_at`
 *
 * Identical logic, and load-bearing in both: `hasStarted` is the whole gate on
 * whether bracket advancement may rewrite a bout's pairing, and `hasBeenFought`
 * is what stops un-doing a parent from silently discarding a played child.
 *
 * DELIBERATELY NOT the predicate `phases.service.ts#scoredMatchesIn` uses. That
 * one asks a narrower question — "is scoring under way" — and answers it from
 * status alone, on purpose. See the comment there.
 *
 * Positional arguments because the two call sites disagree on casing: one holds
 * a camelCase view, the other a snake_case row.
 */
export function hasBeenFought(status: string, startedAt: string | null): boolean {
  return startedAt !== null || ['running', 'paused', 'completed'].includes(status);
}
