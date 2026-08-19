import type { ApiFailure } from '@myclash/api-client';

/**
 * Turn a structured `apiRequest` failure into a sentence for the operator, or
 * `null` when there is nothing to say.
 *
 * `null` is the aborted request: the caller's own doing — a navigation, an
 * unmount, a newer request — and it has no message. This used to be an
 * `Exclude<ApiFailure, { kind: 'aborted' }>` parameter, which read well and was
 * wrong: it forced `if (failure.kind !== 'aborted')` at every call site, and on
 * a request that passes no signal that guard is a branch which cannot fire.
 * CLAUDE.md is explicit that such a branch is the bug. One `null` here replaces
 * seven of them.
 *
 * The core cannot do this itself: hard rule 6 puts every user-facing string in
 * `en` and `fr`, and the shared package holds no catalogue. It is a plain
 * function rather than a hook so it can be unit-tested — web-admin's vitest
 * config maps no `@/` alias and there is no @testing-library in the repo, so a
 * module that reached for either would be untestable by construction.
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
