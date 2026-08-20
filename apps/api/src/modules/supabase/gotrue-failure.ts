/**
 * Which kind of "no" GoTrue just gave us when asked to validate a token.
 *
 * Two different things wear a 4xx here, and only one is about the token.
 * 401/403 are GoTrue JUDGING it — revoked, banned — and must beat a
 * locally-valid signature, which is the whole reason `getAuthUser` makes the
 * round-trip at all. 429 and 408 are GoTrue declining to ANSWER; they say
 * nothing about the token and belong with the 5xx, where the local-verify
 * fallback catches them.
 *
 * They shared the `invalid` bucket until 2026-08-20, so a burst of
 * authenticated traffic could turn a signed-in operator anonymous — and on a
 * draft event that surfaces as `Event "<slug>" not found`, because the public
 * resolver hides drafts from anonymous callers.
 *
 * This only changes WHEN we verify locally, never WHAT local verification
 * accepts: expiry and signature are still enforced by `verifyAccessTokenLocally`.
 */
export function classifyGoTrueFailure(status: number): 'invalid' | 'unavailable' {
  if (status >= 500) return 'unavailable';
  return status === 429 || status === 408 ? 'unavailable' : 'invalid';
}
