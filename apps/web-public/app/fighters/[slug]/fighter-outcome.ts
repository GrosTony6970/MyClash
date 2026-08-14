/**
 * What an HTTP status from `GET /fighters/:slug` means for the page.
 *
 * Extracted from the page so it can be asserted: the page itself is a server
 * component that needs a running API to exercise, and this mapping is the whole
 * of the soft-404 fix.
 *
 * The page used to collapse all of these into `null` and render a "not found"
 * body at HTTP **200**, which had two consequences:
 *
 *  - Every dead slug became an indexable page saying nothing. Point a crawler at
 *    a directory of profile links and it learns thousands of them.
 *  - An API outage turned EVERY profile into that page, still at 200 — so a
 *    crawl during an incident would replace real indexed profiles with
 *    placeholders, and the 410 the API returns for an erased slug (chosen
 *    precisely because search engines drop it faster than a 404) was defeated on
 *    the way out.
 *
 * The rule: "we could not ask" must never look like "there is nothing here".
 */
export type FighterOutcome = 'ok' | 'missing' | 'gone' | 'error';

export function classifyFighterResponse(status: number): FighterOutcome {
  if (status === 404) return 'missing';
  // A slug retired by an anonymisation is GONE, not merely absent.
  if (status === 410) return 'gone';
  if (status >= 200 && status < 300) return 'ok';
  // Everything else — 5xx, 429, a proxy's 502, an unexpected 3xx — is the API
  // failing to answer, not an answer of "no such fighter".
  return 'error';
}

/** Whether the page may render a profile. */
export function isRenderable(outcome: FighterOutcome): boolean {
  return outcome === 'ok';
}

/** Whether the page must 404. Never true for a failure to reach the API. */
export function shouldNotFound(outcome: FighterOutcome): boolean {
  return outcome === 'missing' || outcome === 'gone';
}
