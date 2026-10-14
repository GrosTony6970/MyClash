/**
 * The words for why a CSV import skipped or refused a row (O17), for both imports: an
 * Event's roster and the super admin's Global Profiles. The server says WHY by code
 * (`ImportRowReason`); the page words it in the reader's language.
 *
 * A `switch` of literal `t()` calls, as `referee-reasons.ts`: the i18n sweep resolves keys
 * it can read at the call site. The switch is exhaustive — a code the server adds is a
 * compile error here until it has words (`import-reasons.test.ts` checks EN + FR).
 */
import type { ImportRowProblem } from '@myclash/types';

type Translate = (key: string, values?: Record<string, string>) => string;

/** One row's problem, as a sentence. `value` is the cell it is about, as the file holds it. */
export function importProblemText(t: Translate, { reason, value = '' }: ImportRowProblem): string {
  const v = { value };
  switch (reason) {
    case 'no_file':
      return t('organizer.personsImport.reasons.no_file');
    case 'unreadable_file':
      return t('organizer.personsImport.reasons.unreadable_file');
    case 'missing_given_name':
      return t('organizer.personsImport.reasons.missing_given_name');
    case 'missing_family_name':
      return t('organizer.personsImport.reasons.missing_family_name');
    case 'invalid_email':
      return t('organizer.personsImport.reasons.invalid_email', v);
    case 'invalid_date_of_birth':
      return t('organizer.personsImport.reasons.invalid_date_of_birth', v);
    case 'already_on_roster':
      return t('organizer.personsImport.reasons.already_on_roster');
    case 'repeated_in_file':
      return t('organizer.personsImport.reasons.repeated_in_file');
    case 'not_saved':
      return t('organizer.personsImport.reasons.not_saved');
    case 'no_profile_to_overwrite':
      return t('organizer.personsImport.reasons.no_profile_to_overwrite');
  }
}
