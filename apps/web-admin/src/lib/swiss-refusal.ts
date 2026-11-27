import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

/** The slice of a translator this needs: a key, and the numbers a sentence carries. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Why the API refused a Swiss write, in the reader's language (slice B-Swiss).
 *
 * The API refuses with a `code` and an English sentence: a fighter put back in the pairings while
 * they are out of the tournament (`fighter_out`), a round whose field kept changing while it was
 * paired (`swiss_field_changed`, from generate), a last round that holds a black card or a forfeit
 * (`round_has_records`), and a round-1 seeding that cannot be read (`pool_phase_missing`,
 * `pool_phase_open`, `rating_coverage_low` — the last carries its numbers in `details`). The Swiss
 * tabs ask here first and fall back to `failureMessage` for every other refusal.
 *
 * Literal keys, never composed: the i18n reverse sweep resolves a dotted string literal only.
 */
export function swissRefusal(failure: ApiFailure, t: Translate): string | null {
  switch (failureCode(failure)) {
    case 'fighter_out':
      return t('organizer.swiss.configure.fighterOut');
    case 'swiss_field_changed':
      return t('organizer.swiss.configure.fieldChanged');
    case 'round_has_records':
      return t('organizer.swiss.rounds.roundHasRecords');
    case 'pool_phase_missing':
      return t('organizer.swiss.configure.poolPhaseMissing');
    case 'pool_phase_open':
      return t('organizer.swiss.configure.poolPhaseOpen');
    case 'rating_coverage_low':
      return t('organizer.swiss.configure.ratingCoverageLow', coverageNumbers(failure));
    default:
      return null;
  }
}

/** The four numbers of a `rating_coverage_low` refusal. A missing one reads as "?", never 0. */
function coverageNumbers(failure: ApiFailure): Record<string, string | number> {
  const details = failure.kind === 'http' ? failure.details : null;
  const read = (name: string) => {
    const value = details?.[name];
    return typeof value === 'number' ? value : '?';
  };
  return {
    rated: read('rated'),
    total: read('total'),
    percent: read('percent'),
    threshold: read('threshold'),
  };
}

/** What a Swiss tab shows for a failed call: the refusal above, else the usual. */
export function swissFailureMessage(
  failure: ApiFailure,
  t: Translate,
  fallback: string,
): string | null {
  return swissRefusal(failure, t) ?? failureMessage(failure, t, fallback);
}
