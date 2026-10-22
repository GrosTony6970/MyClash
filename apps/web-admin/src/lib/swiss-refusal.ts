import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

/**
 * Why the API refused a Swiss write, in the reader's language (slice B-Swiss).
 *
 * The API refuses with a `code` and an English sentence: a fighter put back in the pairings while
 * they are out of the tournament (`fighter_out`), a round whose field kept changing while it was
 * paired (`swiss_field_changed`, from generate), a last round that holds a black card or a forfeit
 * (`round_has_records`). The Swiss tabs ask here first and fall back to `failureMessage` for every
 * other refusal.
 *
 * Literal keys, never composed: the i18n reverse sweep resolves a dotted string literal only.
 */
export function swissRefusal(failure: ApiFailure, t: (key: string) => string): string | null {
  switch (failureCode(failure)) {
    case 'fighter_out':
      return t('organizer.swiss.configure.fighterOut');
    case 'swiss_field_changed':
      return t('organizer.swiss.configure.fieldChanged');
    case 'round_has_records':
      return t('organizer.swiss.rounds.roundHasRecords');
    default:
      return null;
  }
}

/** What a Swiss tab shows for a failed call: the refusal above, else the usual. */
export function swissFailureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
  fallback: string,
): string | null {
  return swissRefusal(failure, t) ?? failureMessage(failure, t, fallback);
}
