import type { ApiFailure } from '@myclash/api-client';

/**
 * The i18n keys of the refusals a screen names, by the reason the API gives. The API's error filter
 * puts a 409 thrower's body in `details`, so a 409 names its reason in `details.reason`. A 400
 * names it in the top-level `code`.
 *
 * Literal keys, never composed: the i18n reverse sweep resolves a dotted string literal only.
 */
export interface RefusalKeys {
  conflict?: Readonly<Record<string, string>>;
  badRequest?: Readonly<Record<string, string>>;
}

/** The `details.reason` of a 409; undefined for any other answer. */
export function conflictReason(r: ApiFailure): string | undefined {
  if (r.kind !== 'http' || r.status !== 409) return undefined;
  const reason = r.details?.['reason'];
  return typeof reason === 'string' ? reason : undefined;
}

/** The key of a named refusal, read where the API puts its reason; undefined for any other. */
export function refusalKey(r: ApiFailure, keys: RefusalKeys): string | undefined {
  const reason = conflictReason(r);
  if (reason !== undefined) return keys.conflict?.[reason];
  if (r.kind === 'http' && r.status === 400 && r.code) return keys.badRequest?.[r.code];
  return undefined;
}

/**
 * The refusals of a Tournament's kind of entrant (`apps/api/src/common/entrant-kind-refusal.ts`,
 * `events/tournament-kind.ts`, `phases/team-pool-draw.ts`): double elimination or a Swiss phase asked
 * of a team Tournament, an entrant of the other kind seated in a Pool, a field the kind refuses. A
 * League takes individual Tournaments only (rulings 729, 981): a League link to a team Tournament,
 * and a switch to team under a live League link. A team bracket is not seeded by rating: a team's
 * rating is its named members' (ruling 971).
 */
const KIND_REFUSALS: RefusalKeys = {
  conflict: {
    team_tournament_not_supported: 'organizer.tournaments.kind.teamNotSupported',
    rating_needs_named_members: 'organizer.tournaments.kind.ratingNeedsNamedMembers',
    entrant_kind_mismatch: 'organizer.tournaments.kind.mismatch',
    team_tournament_league: 'organizer.tournaments.kind.leagueIndividualOnly',
    league_link_blocks_team: 'organizer.tournaments.kind.leagueBlocksTeam',
  },
  badRequest: {
    entrant_kind_field: 'organizer.tournaments.kind.fieldRefused',
  },
};

/** The sentence for a refusal of the Tournament's kind, in the reader's language; else null. */
export function kindRefusal(r: ApiFailure, t: (key: string) => string): string | null {
  const key = refusalKey(r, KIND_REFUSALS);
  return key ? t(key) : null;
}
