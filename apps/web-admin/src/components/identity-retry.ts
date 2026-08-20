import type { ApiFailure } from '@myclash/api-client';

/**
 * When the shell's identity check fails, may it try again — and after how long?
 *
 * Extracted from the shells for the same reason as `resolveAuthDecision`: it is
 * a decision, it is worth testing, and a hook is not testable here (the app
 * vitest configs map no `@/` alias and the repo has no @testing-library). The
 * React wiring lives in `useIdentityGate`; the policy lives here.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * Both shells used to send the operator to /login whenever the `/api/v1/me`
 * call did not come back 2xx, and again from the `.catch`. Neither branch is
 * the signed-out path. `me.controller.ts` is `@Public()` and its own docstring
 * says why: "this route IS the identity-discovery mechanism ... it answers
 * `anonymous` with a 200 by design. A 401 here would break every app for
 * logged-out visitors." Being signed out is therefore a 200 carrying
 * `type: 'anonymous'`, which `resolveAuthDecision` already handles correctly.
 *
 * So a non-2xx or a dead socket never meant "signed out" — it meant "could not
 * ask", and the shells answered it by logging the operator out. A few seconds
 * of bad wifi during an event did it.
 *
 * ── The split ───────────────────────────────────────────────────────────────
 * `aborted` is the caller's own unmount and is not a failure to report.
 * `unauthenticated` (401/403) is abnormal on a public route, but it IS an
 * answer about identity rather than a failure to obtain one, so it is not
 * retried — the shell treats it as "not yours" exactly as before.
 * Everything else is "could not ask": a dropped connection, a 5xx, or the 429
 * that a rate limiter returns. Those are retried, briefly.
 */

/**
 * Backoff between attempts, in ms, indexed by how many have already failed.
 * Its length IS the retry budget: three attempts in total, all within about
 * three and a half seconds, which covers a blip without making the operator
 * watch a spinner. Anything longer is not a blip and gets the banner plus a
 * button, rather than a page that retries forever in a background tab.
 */
const BACKOFF_MS = [800, 2400] as const;

/** Attempts in total, including the first. Read by the tests and the banner. */
export const IDENTITY_MAX_ATTEMPTS = BACKOFF_MS.length + 1;

/**
 * `null` means stop — either this failure is an answer rather than an outage,
 * or the budget is spent. `failedAttempts` counts failures so far and is
 * therefore 1-based on the first call.
 */
export function identityRetryDelayMs(failure: ApiFailure, failedAttempts: number): number | null {
  switch (failure.kind) {
    case 'aborted':
    case 'unauthenticated':
      return null;
    case 'network':
    case 'http':
      break;
  }
  // A 4xx other than 429 is the server answering, not failing to. Retrying a
  // 404 or a 400 just asks the same question again and gets the same reply.
  if (failure.kind === 'http' && failure.status < 500 && failure.status !== 429) return null;
  return BACKOFF_MS[failedAttempts - 1] ?? null;
}
