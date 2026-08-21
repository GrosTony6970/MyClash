import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

/**
 * Static keys rather than `t(\`…usernameTaken${suffix}\`)`, for the reason
 * `pin-feedback.ts` gives: a template-literal key is invisible to the i18n
 * reverse sweep, which would then report both strings as orphans and prune
 * them out from under this file.
 */
const USERNAME_TAKEN_KEYS = {
  active: 'organizer.staff.usernameTaken',
  disabled: 'organizer.staff.usernameTakenDisabled',
} as const;

/** The API's extension bag, or null for the failures that have no body. */
function detailsOf(failure: ApiFailure): Record<string, unknown> | null {
  return failure.kind === 'http' || failure.kind === 'unauthenticated' ? failure.details : null;
}

/**
 * Why the staff account was not created, already translated — or null when
 * there is nothing to say (the caller aborted).
 *
 * Until this existed the hook read `res.ok` and nothing else, so every refusal
 * rendered the same "Could not create staff account." An organiser who reused a
 * username was told nothing at all and retried the same one.
 *
 * The name being taken is the refusal worth its own sentence, and the holder's
 * status decides which: the unique index is not partial, so a DISABLED account
 * keeps its username and collides with a row the active roster never shows.
 * There the answer is to re-enable it, and a message that only said "taken"
 * would send the organiser inventing a second name for the same volunteer.
 *
 * Everything else defers to `failureMessage`, which prefers the API's own
 * `detail` over any sentence written here — that is the whole argument for
 * reading the body. `createError` is the last resort, not the only answer.
 */
export function createAccountProblem(
  failure: ApiFailure,
  t: (key: string) => string,
): string | null {
  if (failureCode(failure) === 'staff_username_taken') {
    const existingStatus = detailsOf(failure)?.['existingStatus'];
    return t(
      existingStatus === 'disabled' ? USERNAME_TAKEN_KEYS.disabled : USERNAME_TAKEN_KEYS.active,
    );
  }
  return failureMessage(failure, t, t('organizer.staff.createError'));
}
