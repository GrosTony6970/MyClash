/**
 * Event kind — what an event *is*, and therefore how the platform treats it.
 *
 *   standard  A real competition. Public, results count toward rankings and
 *             fighter statistics, and it cannot be hard-deleted once matches
 *             have been recorded.
 *   test      A dry run. Hidden from every public surface and from personal
 *             spaces, counted nowhere, and disposable at any time.
 *   club      Internal club activity (club night, grading, friendly sparring).
 *             Fully public and visible in personal spaces, but its results
 *             never reach rankings, career statistics or HEMA Ratings — and it
 *             stays disposable.
 *
 * ## Why an enum and not booleans
 *
 * This replaces the original `events.is_test_event` boolean (migration 0113,
 * dropped in 0162). That flag bundled two independent axes — visibility
 * suppression and the hard-delete override — which worked only for as long as
 * every non-standard event wanted both. A club event wants the second without
 * the first, and a second boolean would admit an impossible `test AND club`
 * state. Three mutually exclusive kinds cannot.
 *
 * ## The matrix
 *
 * | kind     | public + /me | stats | dashboard | ratings | announce | hard-delete |
 * |----------|--------------|-------|-----------|---------|----------|-------------|
 * | standard | yes          | yes   | counted   | yes     | yes      | no          |
 * | test     | no           | no    | excluded  | no      | no       | yes         |
 * | club     | yes          | no    | counted   | no      | no       | yes         |
 *
 * ## On the predicates below
 *
 * Three pairs currently share an implementation. **That duplication is
 * deliberate — do not collapse them.** `countsAsPlatformActivity` differing
 * from `countsTowardStats` is a product decision (a club night is real
 * platform activity even though it is not a rated result), and naming the two
 * separately is the only thing that stops a later "consistency" refactor from
 * silently reverting it. The same reasoning applies to `allowsRatingsExport`
 * and `announcesOnPublish`: each names a distinct question that happens to
 * have the same answer today.
 *
 * Callers should always go through these predicates rather than comparing the
 * kind inline. A hand-written `kind !== 'test'` reads as correct at a
 * statistics call site and is not — that is exactly the mistake the named
 * predicates exist to prevent.
 *
 * The module is pure — no I/O, no React, no Node-only APIs — so the NestJS API,
 * both Next apps and the SQL-facing layers all share one definition.
 */

export const EVENT_KINDS = ['standard', 'test', 'club'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const DEFAULT_EVENT_KIND: EventKind = 'standard';

/**
 * Coerce an unknown value (a JSON payload, a PostgREST row) to an EventKind.
 *
 * Anything unrecognised — null, undefined, a typo, a kind added by a newer
 * deployment — becomes 'standard'. That direction is chosen on purpose: the
 * fallback must fail *visible*, never fail *hidden*. Defaulting to 'test'
 * would make a single corrupt value silently erase an event from every public
 * page, which is far harder to notice than the reverse.
 */
export function asEventKind(value: unknown): EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value as string)
    ? (value as EventKind)
    : DEFAULT_EVENT_KIND;
}

/**
 * Public pages (event listing, event home, organiser pages) and personal
 * spaces (/me). Only test events are hidden; club events are fully public.
 */
export function isPubliclyVisible(kind: EventKind): boolean {
  return kind !== 'test';
}

/**
 * Cross-event statistics: fighter career, referee career, league and club
 * standings, group member cards. Only standard results count.
 *
 * Note this is deliberately *not* applied to a tournament's own stats pages —
 * see migrations 0129 and 0135, which establish that a tournament's own
 * standings and exchange stats must reflect that tournament whatever its kind.
 */
export function countsTowardStats(kind: EventKind): boolean {
  return kind === 'standard';
}

/**
 * Super-admin platform dashboard counters only.
 *
 * Deliberately different from {@link countsTowardStats}: a club event is real
 * activity on the platform, unlike a dry run, so it is counted here even
 * though its results are not rated. Do not unify the two.
 */
export function countsAsPlatformActivity(kind: EventKind): boolean {
  return kind !== 'test';
}

/**
 * Whether the event may be hard-deleted directly — bypassing both the
 * recorded-results guard and the archived-event deletion-request detour.
 *
 * Test and club events are both disposable from the platform's perspective: a
 * test event is a dry run, and a club event never fed rankings, so tearing
 * either one down destroys nothing anyone else depends on.
 */
export function allowsDirectHardDelete(kind: EventKind): boolean {
  return kind !== 'standard';
}

/**
 * Whether results may be submitted to HEMA Ratings, the external public rating
 * database. Standard events only — neither dry-run data nor internal club
 * activity belongs in a global rating pool.
 */
export function allowsRatingsExport(kind: EventKind): boolean {
  return kind === 'standard';
}

/**
 * Whether first publication announces the event to the organisation's
 * followers. Standard events only: a test event is invisible anyway, and a
 * weekly club night notifying every follower reads as spam.
 */
export function announcesOnPublish(kind: EventKind): boolean {
  return kind === 'standard';
}
