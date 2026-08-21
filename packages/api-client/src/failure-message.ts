import type { ApiFailure } from './request';

/**
 * Turn a structured `apiRequest` failure into a sentence for the operator, or
 * `null` when there is nothing to say.
 *
 * ── Why it lives beside `apiRequest` and not in an app ──────────────────────
 * It switches on `ApiFailure`, and `ApiFailure` is declared one file away. A
 * new member on that union has to break this switch in the same package, in the
 * same commit — which is the whole reason the union is exhaustive and carries no
 * `default:`. It started in web-admin, where a second copy was one converted
 * web-public file away; `createApiClient` (four call sites) and `api-error.ts`
 * (one consumer) are what happens when a shared mapper is a suggestion.
 *
 * It still holds no strings. `t` is a parameter and stays one: hard rule 6 puts
 * every user-facing string in `en` and `fr`, and this package holds no
 * catalogue. What it names is KEYS, and `common.apiFailure.*` is in the shared
 * `common` namespace all three surfaces already compose. A plain function
 * rather than a hook, so it can be unit-tested — there is no @testing-library
 * in the repo and the app vitest configs map no `@/` alias, so a module
 * reaching for either would be untestable by construction.
 *
 * `null` is the aborted request: the caller's own doing — a navigation, an
 * unmount, a newer request — and it has no message. This used to be an
 * `Exclude<ApiFailure, { kind: 'aborted' }>` parameter, which read well and was
 * wrong: it forced `if (failure.kind !== 'aborted')` at every call site, and on
 * a request that passes no signal that guard is a branch which cannot fire.
 * CLAUDE.md is explicit that such a branch is the bug. One `null` here replaces
 * seven of them.
 *
 * ── 4xx: the server's reason wins, in English, and ALL of it ────────────────
 * A class-validator refusal names every field it rejected, but `detail` carries
 * only the first: `normalizeMessage` in the API's exception filter collapses
 * the array and `buildDetails` puts the rest under `details.validationErrors`.
 * Nothing read that until 2026-08-21, so an organiser who left four fields
 * wrong was told about one, fixed it, and was told about the next.
 *

 * For a failed 4xx the API's own `detail` IS the message. Reading it is the
 * reason api-error.ts was written: a backup failure used to report nothing more
 * useful than "Could not delete backups." while the server's reason sat unread
 * in the body.
 *
 * That reason is English — the API authors it at ~1,900 throw sites and has no
 * locale to author it in, since it does not depend on @myclash/i18n and is
 * never told the request's language. Ruled on 2026-08-20 and settled: a French
 * organiser reads English on a 4xx. The alternatives were costed and declined —
 * dropping `detail` re-creates the bug above, and translating at the API is
 * ~1,900 coded throws plus a key pair each. Do not re-open this by adding a
 * "translate the detail" branch here; the decision is the API's to revisit.
 *
 * ── 5xx: the screen's own sentence wins ─────────────────────────────────────
 * The exception filter scrubs every ≥500 body to the literal "Internal server
 * error" so no stack or connection string can reach a browser. It also fills
 * `detail` on EVERY problem+json body — so before 2026-08-20 that placeholder
 * outranked the localised sentence the call site passed, and `fallback` could
 * only ever be seen when the body was not JSON at all (an edge proxy's HTML
 * error page). A branch that almost cannot fire is the bug CLAUDE.md names.
 *
 * 503 is the exception, and the reason is structural rather than a guess:
 * `OperationalUnavailableException` is the filter's ONLY unscrubbed ≥500 path,
 * its message is authored for the operator, and it is always a 503. Stated
 * plainly because it is a client-side belief about the API — if a second
 * unscrubbed 5xx is ever added, or that one stops being a 503, this goes wrong
 * silently and the test named for it is what should catch it.
 */
/**
 * The failure's machine-readable code, or `null` when it has none.
 *
 * Two of the four `ApiFailure` members carry one, so a call site branching on a
 * code has to narrow first — and `failure.kind !== 'aborted' && failure.code`
 * is wrong, because `network` has no code either. Getting that narrowing right
 * once here beats getting it right at every screen that tells one refusal from
 * another.
 */
export function failureCode(failure: ApiFailure): string | null {
  return failure.kind === 'http' || failure.kind === 'unauthenticated' ? failure.code : null;
}

/**
 * The server's own sentence, or `null`. The same narrowing as `failureCode`,
 * for the reader that cannot use `failureMessage` — a React Server Component
 * has no translator on its side of the boundary, so it renders the API's
 * sentence beside a status line rather than a localised one.
 *
 * Prefer `failureMessage` anywhere a `t` is in reach: it also picks the right
 * string for a network failure, an abort and a scrubbed 5xx, which this does
 * not.
 */
export function failureDetail(failure: ApiFailure): string | null {
  return failure.kind === 'http' || failure.kind === 'unauthenticated' ? failure.detail : null;
}

export function failureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
  /**
   * Already translated. A screen that can say "Could not save the backup
   * schedule." should; `common.error` is for the one that has nothing better.
   * On a 4xx it does NOT override `detail` — the server's reason beats a guess,
   * which is the whole argument for reading the body at all. On a scrubbed 5xx
   * it does, because there the "reason" is a placeholder that says less.
   */
  fallback?: string,
): string | null {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'network':
      return t('common.apiFailure.network');
    case 'unauthenticated':
      // Neither half of a problem+json body — so this did not come from the
      // API, which fills `detail` and `code` on every one it sends. Something
      // between the browser and the API answered instead. Saying "your session
      // expired, sign in again" there is worse than saying nothing: it is
      // wrong, and it sends the operator to a login screen that cannot help.
      //
      // This is not hypothetical. A Traefik fail2ban jail on the staff API
      // router answered a gear check 403 in 0ms on 2026-08-21, and the pad told
      // the volunteer their session had gone.
      if (failure.detail === null && failure.code === null) {
        return t('common.apiFailure.blocked');
      }
      // A 403 usually names the thing you may not do, and that beats our
      // sentence. A 401 does not: the server's word for it is "Unauthorized",
      // while ours says the session expired AND what to do about it.
      return failure.status === 403
        ? (failure.detail ?? t('common.apiFailure.unauthenticated'))
        : t('common.apiFailure.unauthenticated');
    case 'http':
      // A scrubbed 5xx carries a placeholder, not a reason. 503 is the one
      // ≥500 the filter lets through with real words — see the header.
      if (failure.status >= 500 && failure.status !== 503) {
        return fallback ?? t('common.error');
      }
      // Every rejected field, ahead of `detail`, which is only the first of
      // them. Deliberately not guarded on length: with one entry the join IS
      // `detail`, so a `length > 1` test would be a branch whose two arms
      // cannot be told apart.
      if (failure.validationErrors) return failure.validationErrors.join(VALIDATION_SEPARATOR);
      return failure.detail ?? fallback ?? t('common.error');
  }
}

/**
 * Between rejected fields. Each entry is a whole sentence ("email must be an
 * email"), so a comma reads as though the list were one clause; the middle dot
 * keeps them separate at a glance and needs no translation.
 */
const VALIDATION_SEPARATOR = ' · ';
