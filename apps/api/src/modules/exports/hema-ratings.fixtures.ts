/**
 * Shared fixtures for the HEMA Ratings submission tests.
 *
 * Extracted so the round-naming suite can live in its own file without
 * duplicating the builders — `match()` is used by the outcome, round-naming
 * and buildSubmission suites alike, and a copy per file would let them drift
 * into asserting against three different default matches.
 */

import type { SubmissionFighter, SubmissionMatch } from './hema-ratings-submission';

export function fighter(
  overrides: Partial<SubmissionFighter> & { personId: string },
): SubmissionFighter {
  return {
    givenName: 'Jean',
    familyName: 'Dupont',
    clubId: null,
    nationality: 'FR',
    genderCategory: null,
    hemaRatingsId: '123',
    ...overrides,
  };
}

export function match(overrides: Partial<SubmissionMatch> & { id: string }): SubmissionMatch {
  return {
    redPersonId: 'p1',
    bluePersonId: 'p2',
    winnerPersonId: 'p1',
    endReason: null,
    forfeited: false,
    phaseType: 'pool',
    phaseConfig: null,
    poolSortOrder: 0,
    bracketRound: null,
    swissRound: null,
    matchLabel: null,
    ...overrides,
  };
}

export function rowsOf(csv: string): string[][] {
  // No header row to skip — see HEADER_ROW. No fixture contains a quoted newline.
  return csv.split('\n').map((line) => line.split(','));
}
