import { ConflictException } from '@nestjs/common';

/**
 * The kind triggers' refusals (migrations 0281 and 0287), as the 409 a screen can name.
 *
 * A Tournament holds one kind of entrant: Registrations when it is individual, teams when it is a
 * team Tournament. The database refuses the other kind (`entrant_kind_holds`), and refuses a change
 * of kind once the Tournament holds any entrant (`entrant_kind_is_settled`). A League takes
 * individual Tournaments only (rulings 729, 981): the database refuses a live League link to a team
 * Tournament (`league_link_individual_only`), and a switch to team while a live link exists
 * (`league_link_blocks_team`). Each raises `check_violation` (23514) with the trigger's name first
 * in the message: PostgREST does not pass the constraint name on, so the prefix is what is matched,
 * as `registrations.service.ts` matches its unique key by text. The prefixes are proved against a
 * real database by the cascade probe (`scripts/lib/team-kind-race.mjs`).
 *
 * The `reason` is the stable name a client translates (EN and FR); `message` is the English
 * sentence for a log or a client that has no translation yet.
 */
const REFUSALS = [
  {
    prefix: 'entrant_kind_holds:',
    reason: 'entrant_kind_mismatch',
    message:
      'This Tournament takes the other kind of entrant: a team Tournament takes teams, an individual one takes Fighters.',
  },
  {
    prefix: 'entrant_kind_is_settled:',
    reason: 'entrant_kind_settled',
    message: 'This Tournament already has entrants, so its kind cannot change.',
  },
  {
    prefix: 'league_link_individual_only:',
    reason: 'team_tournament_league',
    message: 'A League takes individual Tournaments only: League points belong to persons.',
  },
  {
    prefix: 'league_link_blocks_team:',
    reason: 'league_link_blocks_team',
    message: 'Remove the League link first: League points belong to persons.',
  },
] as const;

const CHECK_VIOLATION = '23514';

/**
 * The 409 for what a team Tournament does not take yet: its Pools and a single elimination bracket
 * run, double elimination and Swiss have no team path (ADR-022, call 2 of slice 1c-1). A route that
 * is not a phase says its own English sentence; the `reason` stays the same.
 */
export function teamTournamentNotSupported(
  message = 'A team Tournament takes no double elimination and no Swiss phase yet.',
): ConflictException {
  return new ConflictException({ reason: 'team_tournament_not_supported', message });
}

/**
 * The 409 for a team bracket seeded by rating: a team's rating is its named members' (ruling 971),
 * and the teams have no names until slice 1c-2.
 */
export function ratingNeedsNamedMembers(): ConflictException {
  return new ConflictException({
    reason: 'rating_needs_named_members',
    message:
      'A team is rated by its named members, so a team bracket cannot be seeded by rating yet.',
  });
}

/**
 * The 409 of a trigger's refusal, found by its reason, never by its place in the list: a refusal
 * added before it must not change what a door says. The reason's type holds only the list's own.
 */
function conflictOf(reason: (typeof REFUSALS)[number]['reason']): ConflictException {
  const { message } = REFUSALS.find((r) => r.reason === reason)!;
  return new ConflictException({ reason, message });
}

/** The 409 for an entrant of the other kind, said by the API before the database would refuse it. */
export function entrantKindMismatch(): ConflictException {
  return conflictOf('entrant_kind_mismatch');
}

/**
 * The 409 for a League link to a team Tournament, said by a League door before the database would
 * refuse it (rulings 729, 981): the same reason as the trigger's, so one screen sentence names both.
 */
export function teamTournamentLeague(): ConflictException {
  return conflictOf('team_tournament_league');
}

/** The 409 for a write a kind trigger refused; null for any other error. */
export function entrantKindRefusal(
  error: { code?: string | null; message?: string | null } | null | undefined,
): ConflictException | null {
  if (error?.code !== CHECK_VIOLATION) return null;
  const refusal = REFUSALS.find((r) => error.message?.startsWith(r.prefix));
  return refusal
    ? new ConflictException({ reason: refusal.reason, message: refusal.message })
    : null;
}
