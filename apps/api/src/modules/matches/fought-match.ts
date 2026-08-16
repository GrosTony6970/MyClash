/**
 * "This bout has been fought", as one predicate.
 *
 * Sibling of `unplayed-match-columns.ts`, and the other half of the same
 * question: that module says which columns a never-played bout carries, this one
 * says how to recognise a played one.
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
 * PRECONDITION: callers exclude voided rows before asking. Both do, at the
 * query — `loadSlotMatch` in bracket-match-sync.ts and the matches read inside
 * `dependentClosure` each carry `.not('status', 'eq', 'voided')`. This returns
 * true for a voided bout that once ran, and nothing reaches it with one.
 *
 * THE `started_at` DISJUNCT CANNOT CURRENTLY CHANGE THE ANSWER, and is kept
 * anyway. Exactly two writers touch `matches.started_at`: `clock.service.ts`
 * sets it in the same update as `status='running'`, and `unplayedMatchColumns`
 * nulls it in the same object as `status='scheduled'`. No insert sets it. So a
 * non-null `started_at` implies the status is already one of the three below —
 * except for voided, which the precondition excludes.
 *
 * That makes it defence against a row this codebase cannot write, and dropping
 * it reds this module's unit tests and NOTHING else. Expected, not a hole in the
 * coverage: there is no call-site test to write for an unreachable state. It
 * stays because the cost of a wrong "no" here is a played result discarded in
 * silence, and because the two columns moving together is a property of
 * `unplayedMatchColumns`, not a guarantee of the schema.
 *
 * NOT the predicate `phases.service.ts#scoredMatchesIn` uses — the same three
 * statuses, but a different question and a different cost of being wrong. See
 * the comment there before merging them.
 *
 * Positional arguments because the two call sites disagree on casing: one holds
 * a camelCase view, the other a snake_case row.
 */
export function hasBeenFought(status: string, startedAt: string | null): boolean {
  return startedAt !== null || ['running', 'paused', 'completed'].includes(status);
}
