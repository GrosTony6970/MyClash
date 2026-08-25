/**
 * Why the API refused a reset or a reopen, in words a referee can act on.
 *
 * The pad used to render `body.message` verbatim, which is English written for
 * whoever reads the logs — "A later bout has already been fought. Undoing this
 * result would invalidate it." A scorekeeper mid-event needs to know what to do
 * next, in the language the rest of the pad is in.
 *
 * NO PRE-FLIGHT HERE, deliberately — this is not `UncompleteConfirm.tsx` with
 * the fetch swapped out. Two reasons the organiser app's shape does not port:
 *
 *   1. The pad is offline-capable. `sw.js` answers every `/api/` request with a
 *      synthetic `{error:'offline', status:503}` and never caches one, so a GET
 *      pre-flight cannot resolve offline — it would show a spinner that never
 *      finishes, on the surface that most needs to keep working.
 *   2. A PIN scorekeeper gets `canDiscardDependentResults: false`, so the answer
 *      a pre-flight would give them is always "ask an organiser". Asking the
 *      server first to be told that costs a round trip to learn nothing.
 *
 * So it maps the `code` the refusal already carries. The server keeps deciding;
 * the pad only translates. Anything unrecognised falls through to the server's
 * own words rather than a generic apology — same principle as
 * `QuarantineInbox.tsx`, where the server's message is the useful part.
 *
 * ── That switch did not fire until 2026-08-21 ───────────────────────────────
 * The codes below are thrown as `ConflictException({ message, foughtCount,
 * code })`, and the exception filter used to send `code` at the top level from
 * the STATUS — 'CONFLICT' — while the thrower's own code and payload went into
 * `details`. So `body.code` never matched a case, and every refusal fell to
 * `body.message`: the API English this file was written to stop a referee
 * reading. The filter folds both throw shapes into one `code` now, and this
 * takes an `ApiFailure`, which carries `code` and the payload bag separately.
 *
 * `foughtCount` was the same bug one level down — it lived in `details` too, so
 * even a matching case would have said "a later bout" for three of them.
 */

import type { ApiFailure } from '@myclash/api-client';

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Literal keys, never composed — the i18n reverse sweep resolves a dotted string
// literal but needs a MANUAL_PREFIXES entry for anything templated.
const DEPENDENTS_ONE = 'scoring.corrections.dependentsBlockedOne';
const DEPENDENTS_MANY = 'scoring.corrections.dependentsBlockedMany';
const FORFEIT_BLOCKED = 'scoring.corrections.forfeitBlocked';
const SWISS_AHEAD = 'scoring.corrections.swissRoundAhead';
const ORGANISER_ONLY = 'scoring.corrections.organiserOnly';
const OFFLINE = 'scoring.corrections.offlineRefusal';
const LEVEL_EXTRA_TIME = 'scoring.level.refusedExtraTime';
const LEVEL_SUDDEN_DEATH = 'scoring.level.refusedSuddenDeath';

/**
 * `t()` has no plural engine, so one needs its own key rather than "the 1 later
 * bouts". Same convention as the organiser app's `counted`.
 */
const counted = (t: Translate, one: string, many: string, count: number): string =>
  count === 1 ? t(one) : t(many, { count });

/** How many later bouts a refusal says would be discarded. */
function foughtCount(details: Record<string, unknown> | null): number {
  const count = details?.['foughtCount'];
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * What a referee does about a bout that is level when the clock runs out.
 *
 * Sudden death is the fallback, and deliberately: it is the only remedy that
 * needs no number, so an unrecognised or missing `remedy` still tells the
 * referee something true — play on until one of them leads.
 */
function levelAtTime(t: Translate, details: Record<string, unknown> | null): string {
  const seconds = details?.['seconds'];
  if (details?.['remedy'] === 'extra_time' && typeof seconds === 'number') {
    return t(LEVEL_EXTRA_TIME, { seconds });
  }
  return t(LEVEL_SUDDEN_DEATH);
}

export function refusalMessage(
  failure: ApiFailure,
  t: Translate,
  fallbackKey: string,
): string | null {
  // The caller's own doing — nothing to say. Not reachable from the pad today,
  // which passes no signal, but the mapper is the place that knows it.
  if (failure.kind === 'aborted') return null;

  // The pad is offline-capable and `sw.js` turns a dead network into a
  // synthetic 503, so that IS the offline case rather than a server fault.
  // A genuine `network` failure only happens before the worker installs.
  if (failure.kind === 'network') return t(OFFLINE);
  if (failure.status === 503) return t(OFFLINE);

  switch (failure.code) {
    case 'dependent_results_would_be_discarded':
      return counted(t, DEPENDENTS_ONE, DEPENDENTS_MANY, foughtCount(failure.details));
    case 'forfeit_withdrew_fighter':
      return t(FORFEIT_BLOCKED);
    case 'swiss_later_round_already_drawn':
      return t(SWISS_AHEAD);
    case 'uncomplete_requires_organiser':
      return t(ORGANISER_ONLY);
    case 'level_at_time_unresolved':
      // The bout is level and the phase says play it out. `remedy` carries which
      // one; the server's own message names it in English, which is exactly what
      // this file exists to keep off a referee's tablet.
      return levelAtTime(t, failure.details);
    default:
      break;
  }

  // A 403 on one of these routes is always the same thing — the actor may act on
  // the bout but may not discard what a later one produced. Kept as a status
  // check as well as a code, because `authorizeMatchScoring` can refuse earlier
  // than the un-completion owner and never reaches a code at all.
  if (failure.status === 403) return t(ORGANISER_ONLY);

  return failure.detail ?? t(fallbackKey);
}
