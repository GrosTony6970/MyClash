/**
 * Setup data the pad keeps on the tablet, so it can seed from the last good
 * answer instead of the federal default.
 *
 * WHY THIS EXISTS. The pad reads its scoring buttons from the tournament at
 * runtime, into state that starts at `DEFAULT_SCORING_CONFIG` — `+2`/`+1`,
 * deductive. The fetch is guarded `if (res.ok)`, so a failure leaves the
 * defaults and reports nothing, and the service worker caches no `/api/`
 * response at all. The match and the config are separate requests, so on a weak
 * hall network one lands and the other does not: the pad then renders a working
 * scoring surface with the wrong buttons. A referee taps `+2` on a tournament
 * whose ruleset says `+3`, a 2 is queued, a 2 is stored, and nothing ever says
 * so.
 *
 * WHAT IT DOES NOT DO. This is setup data, never live match state. The worker's
 * rule — serve no stale scoring data — is the right rule and stays: a stale
 * score is worse than no score. A stale BUTTON is not, because the alternative
 * is a default that is silently wrong and equally stale.
 *
 * A cached answer can be out of date if an organiser re-pins the ruleset
 * mid-event. The network fetch overwrites it on success, and stale-but-real
 * beats federal-default. `fetchedAt` is carried so a surface can say how old it
 * is rather than implying it is current.
 */
import { db, type CachedRead } from './db';

/** The last good body for `path`, or null if we have never had one. */
export async function readCached<T>(path: string): Promise<{ body: T; fetchedAt: number } | null> {
  const row = await db.reads.get(path);
  if (!row) return null;
  return { body: row.body as T, fetchedAt: row.fetchedAt };
}

/** Remember a successful response. Overwrites whatever was there. */
export async function writeCached(path: string, body: unknown): Promise<void> {
  const row: CachedRead = { path, body, fetchedAt: Date.now() };
  await db.reads.put(row);
}

/**
 * Fetch, cache on success, fall back to cache on failure.
 *
 * Returns `fresh: false` when the answer came off the tablet, so the caller can
 * say so. Returns null only when the network failed AND nothing is cached —
 * which is the one case where the pad genuinely does not know, and must say
 * that rather than quietly arming defaults.
 *
 * A non-ok response counts as a failure here on purpose: the worker resolves a
 * synthetic 503 offline rather than throwing, so `ok` is the only signal that
 * separates a real answer from a manufactured one.
 */
export async function fetchWithCache<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ body: T; fetchedAt: number; fresh: boolean } | null> {
  try {
    const res = await fetch(`${apiUrl}${path}`, init);
    if (res.ok) {
      const body = (await res.json()) as T;
      await writeCached(path, body);
      return { body, fetchedAt: Date.now(), fresh: true };
    }
  } catch {
    // Fall through to the cache. An abort lands here too, and returning the
    // cached copy for one is harmless: the caller has already moved on.
  }
  const cached = await readCached<T>(path);
  return cached ? { ...cached, fresh: false } : null;
}
