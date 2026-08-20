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
 * For a failed response the API's own `detail` IS the message. Reading it is
 * the reason api-error.ts was written: a backup failure used to report nothing
 * more useful than "Could not delete backups." while the server's reason sat
 * unread in the body. It is English — the API authors it — which is exactly
 * what the 138 sites reading `body.message` already ship. The ≥500 bodies are
 * scrubbed to "Internal server error" by the API's exception filter, so no
 * stack or connection string can arrive through this path.
 */
export function failureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
  /**
   * Already translated, and read only when the response gave no reason of its
   * own. A screen that can say "Could not save the backup schedule." should;
   * `common.error` is for the one that has nothing better. It does NOT override
   * `detail` — the server's reason beats a guess, which is the whole argument
   * for reading the body at all.
   */
  fallback?: string,
): string | null {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'network':
      return t('common.apiFailure.network');
    case 'unauthenticated':
      return t('common.apiFailure.unauthenticated');
    case 'http':
      return failure.detail ?? fallback ?? t('common.error');
  }
}
