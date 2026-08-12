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
 */

/** The shape a Nest exception body arrives in. All fields optional — a 503 from
 *  the service worker has none of them. */
export interface RefusalBody {
  message?: string;
  code?: string;
  error?: string;
  foughtCount?: number;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Literal keys, never composed — the i18n reverse sweep resolves a dotted string
// literal but needs a MANUAL_PREFIXES entry for anything templated.
const DEPENDENTS_ONE = 'scoring.corrections.dependentsBlockedOne';
const DEPENDENTS_MANY = 'scoring.corrections.dependentsBlockedMany';
const FORFEIT_BLOCKED = 'scoring.corrections.forfeitBlocked';
const SWISS_AHEAD = 'scoring.corrections.swissRoundAhead';
const ORGANISER_ONLY = 'scoring.corrections.organiserOnly';
const OFFLINE = 'scoring.corrections.offlineRefusal';

/**
 * `t()` has no plural engine, so one needs its own key rather than "the 1 later
 * bouts". Same convention as the organiser app's `counted`.
 */
const counted = (t: Translate, one: string, many: string, count: number): string =>
  count === 1 ? t(one) : t(many, { count });

export function refusalMessage(
  status: number,
  body: RefusalBody | null | undefined,
  t: Translate,
  fallbackKey: string,
): string {
  // The service worker's stand-in for "the network is not there". It has no
  // `message`, so without this the operator gets the generic failure string and
  // no hint that the pad is simply offline.
  if (status === 503 || body?.error === 'offline') return t(OFFLINE);

  switch (body?.code) {
    case 'dependent_results_would_be_discarded':
      return counted(t, DEPENDENTS_ONE, DEPENDENTS_MANY, body.foughtCount ?? 1);
    case 'forfeit_withdrew_fighter':
      return t(FORFEIT_BLOCKED);
    case 'swiss_later_round_already_drawn':
      return t(SWISS_AHEAD);
    case 'uncomplete_requires_organiser':
      return t(ORGANISER_ONLY);
    default:
      break;
  }

  // A 403 on one of these routes is always the same thing — the actor may act on
  // the bout but may not discard what a later one produced. Kept as a status
  // check as well as a code, because `authorizeMatchScoring` can refuse earlier
  // than the un-completion owner and never reaches a code at all.
  if (status === 403) return t(ORGANISER_ONLY);

  return body?.message ?? t(fallbackKey);
}
