/**
 * PostgREST row → submission shape mappers.
 *
 * Split out of exports.service.ts so the service reads as "which queries, in
 * what order" and the column-by-column translation lives somewhere it can be
 * read on its own.
 */

import type { SubmissionClub, SubmissionFighter, SubmissionMatch } from './hema-ratings-submission';

export type Row = Record<string, unknown>;

export function toSubmissionMatch(row: Row, forfeitedMatchIds: Set<string>): SubmissionMatch {
  const phase = row['phases'] as Row | null;
  const pool = row['pools'] as Row | null;
  const slot = row['bracket_slots'] as Row | null;
  const swissRound = row['swiss_rounds'] as Row | null;
  const matchId = row['id'] as string;

  const redPersonId = ((row['red_reg'] as Row | null)?.['person_id'] as string | null) ?? null;
  const bluePersonId = ((row['blue_reg'] as Row | null)?.['person_id'] as string | null) ?? null;
  const winnerRegistrationId = row['winner_registration_id'] as string | null;

  return {
    id: matchId,
    redPersonId,
    bluePersonId,
    // The winner is stored as a registration; the export speaks in persons.
    winnerPersonId:
      winnerRegistrationId === null
        ? null
        : winnerRegistrationId === row['red_registration_id']
          ? redPersonId
          : winnerRegistrationId === row['blue_registration_id']
            ? bluePersonId
            : null,
    endReason: (row['end_reason'] as string | null) ?? null,
    forfeited: forfeitedMatchIds.has(matchId),
    phaseType: (phase?.['type'] as string | undefined) ?? '',
    phaseConfig: (phase?.['config_json'] as Record<string, unknown> | null) ?? null,
    poolSortOrder: typeof pool?.['sort_order'] === 'number' ? pool['sort_order'] : null,
    bracketRound: typeof slot?.['round'] === 'number' ? slot['round'] : null,
    // Reads null until the query selects the `swiss_rounds` embed, which has to
    // wait for `matches.swiss_round_id` to exist — naming an unknown column in
    // the select 400s the WHOLE PostgREST query and empties the export for
    // every tournament, not just Swiss ones.
    swissRound:
      typeof swissRound?.['round_number'] === 'number' ? swissRound['round_number'] : null,
    matchLabel: (row['match_number_label'] as string | null) ?? null,
  };
}

export function toSubmissionClub(row: Row): SubmissionClub {
  return {
    id: row['id'] as string,
    name: (row['name'] as string | null) ?? '',
    countryCode: (row['country_code'] as string | null) ?? null,
    city: (row['city'] as string | null) ?? null,
    website: (row['website'] as string | null) ?? null,
  };
}

export function toSubmissionFighter(
  row: Row,
  clubCountryById: Map<string, string | null>,
): SubmissionFighter {
  const globalPerson = row['global_persons'] as Row | null;
  const clubId = (row['club_id'] as string | null) ?? null;
  // The fighter's own country wins; the club's is the fallback — the same
  // precedence the vw_tournament_query_fighters view already uses.
  const nationality =
    (globalPerson?.['country_code'] as string | null | undefined) ??
    (clubId ? (clubCountryById.get(clubId) ?? null) : null);

  return {
    personId: row['id'] as string,
    givenName: (row['given_name'] as string | null) ?? '',
    familyName: (row['family_name'] as string | null) ?? '',
    clubId,
    nationality: nationality ?? null,
    genderCategory: (row['gender_category'] as string | null) ?? null,
    hemaRatingsId: (row['hema_ratings_id'] as string | null) ?? null,
  };
}
