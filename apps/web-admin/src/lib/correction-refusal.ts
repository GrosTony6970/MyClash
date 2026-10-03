import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

/**
 * Why the API refused a correction on a finished bout, in the reader's language.
 *
 * A correction lands whole or not at all (ruling 226): when a later bout was
 * fought from the result, or when the board would be level where no draw is
 * allowed, the API refuses with a `code`. Its own sentence is English, so the
 * screens that can correct a bout ask here first and fall back to
 * `failureMessage` for every other refusal.
 *
 * Literal keys, never composed: the i18n reverse sweep resolves a dotted string
 * literal only.
 */
export function correctionRefusal(failure: ApiFailure, t: (key: string) => string): string | null {
  switch (failureCode(failure)) {
    case 'correction_later_bout_fought':
      return t('admin.common.correctionLaterBoutFought');
    case 'correction_leaves_bout_level':
      return t('admin.common.correctionLeavesBoutLevel');
    default:
      return null;
  }
}

/** What a screen that corrects a bout shows for a failed call: the refusal above, else the usual. */
export function correctionFailureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
  fallback: string,
): string | null {
  return correctionRefusal(failure, t) ?? failureMessage(failure, t, fallback);
}
