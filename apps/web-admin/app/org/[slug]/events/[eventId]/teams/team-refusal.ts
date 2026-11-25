import { failureMessage, type ApiFailure } from '@myclash/api-client';
import { refusalKey, type RefusalKeys } from '@/lib/named-refusal';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The refusals of a team write. The 409s, by `details.reason`: `apps/api/src/modules/teams/
 * team-refusals.ts`, and `entrantKindRefusal` for a Tournament of the other kind. The 400s, by the
 * top-level `code`: `teams.service.ts`, create.
 */
const TEAM_REFUSALS: RefusalKeys = {
  conflict: {
    tournament_full: 'organizer.teams.refusal.tournamentFull',
    team_name_taken: 'organizer.teams.refusal.nameTaken',
    team_size_locked: 'organizer.teams.refusal.sizeLocked',
    team_in_bouts: 'organizer.teams.refusal.inBouts',
    entrant_kind_mismatch: 'organizer.teams.refusal.kindMismatch',
  },
  badRequest: {
    team_size_required: 'organizer.teams.refusal.sizeRequired',
  },
};

/**
 * The sentence for a refused team write: a named refusal in the reader's language, else the API's
 * own reason or `fallback` (`failureMessage`). Null for an aborted request.
 */
export function teamRefusal(r: ApiFailure, t: Translate, fallback: string): string | null {
  const key = refusalKey(r, TEAM_REFUSALS);
  return key ? t(key) : failureMessage(r, t, fallback);
}
