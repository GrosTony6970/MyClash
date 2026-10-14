import type { CsvImportReport, ImportPreviewResponse } from '@myclash/types';

/**
 * The answers of the roster import's two routes to a request with no file. They
 * are whole answers of their type: the page reads every field of a report.
 */
export function noFilePreview(): ImportPreviewResponse {
  return {
    summary: { toCreate: 0, toLink: 0, duplicates: 0, invalid: 1 },
    newClubs: [],
    unknownColumns: [],
    rows: [
      {
        index: 0,
        line: null,
        givenName: '',
        familyName: '',
        status: 'invalid',
        reason: 'no_file',
        defaultAction: 'create_new',
      },
    ],
  };
}

export function noFileReport(): CsvImportReport {
  return {
    created: 0,
    duplicates: [],
    invalid: [{ line: null, reason: 'no_file', raw: '' }],
    newClubsForReview: [],
    unmatchableIdentities: [],
  };
}
