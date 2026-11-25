import { failureMessage, type ApiFailure } from '@myclash/api-client';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The 409 refusals of a team write, by `details.reason`: the API's error filter puts the thrower's
 * body in `details` and `code: CONFLICT` at the top (`apps/api/src/modules/teams/team-refusals.ts`,
 * and `entrantKindRefusal` for a Tournament of the other kind).
 */
const CONFLICT_KEYS: Readonly<Record<string, string>> = {
  tournament_full: 'organizer.teams.refusal.tournamentFull',
  team_name_taken: 'organizer.teams.refusal.nameTaken',
  team_size_locked: 'organizer.teams.refusal.sizeLocked',
  team_in_bouts: 'organizer.teams.refusal.inBouts',
  entrant_kind_mismatch: 'organizer.teams.refusal.kindMismatch',
};

/** The 400 refusals of a team write, by the top-level `code` (`teams.service.ts`, create). */
const BAD_REQUEST_KEYS: Readonly<Record<string, string>> = {
  team_size_required: 'organizer.teams.refusal.sizeRequired',
};

function refusalKey(r: ApiFailure): string | undefined {
  if (r.kind !== 'http') return undefined;
  if (r.status === 409) {
    const reason = r.details?.['reason'];
    return typeof reason === 'string' ? CONFLICT_KEYS[reason] : undefined;
  }
  if (r.status === 400 && r.code) return BAD_REQUEST_KEYS[r.code];
  return undefined;
}

/**
 * The sentence for a refused team write: a named refusal in the reader's language, else the API's
 * own reason or `fallback` (`failureMessage`). Null for an aborted request.
 */
export function teamRefusal(r: ApiFailure, t: Translate, fallback: string): string | null {
  const key = refusalKey(r);
  return key ? t(key) : failureMessage(r, t, fallback);
}
