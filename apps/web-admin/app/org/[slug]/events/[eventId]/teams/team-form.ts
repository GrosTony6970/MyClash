import { numberOrNull, textOf } from '../tournaments/_shared/entrant-kind';

/** A team as `GET /tournaments/:id/teams` answers it (`TeamView`, `teams.service.ts`). */
export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  slug: string;
  size: number;
  seed: number | null;
  color: string | null;
  logoUrl: string | null;
}

/** A team Tournament as the page picks among them. */
export interface TeamTournament {
  id: string;
  name: string;
  color: string | null;
  /** The size a new team starts from; null for none. */
  teamDefaultSize: number | null;
}

/** The team dialog's fields, as typed. Blank is none. */
export interface TeamForm {
  name: string;
  size: string;
  color: string;
  seed: string;
}

/** The dialog's fields for `team`, or for a new team of a Tournament of `defaultSize`. */
export function formOf(team: Team | null, defaultSize: number | null): TeamForm {
  if (!team) return { name: '', size: textOf(defaultSize), color: '', seed: '' };
  return {
    name: team.name,
    size: String(team.size),
    color: team.color ?? '',
    seed: textOf(team.seed),
  };
}

/**
 * A create's body: what was filled. A blank size is left out, so the Tournament's default size
 * applies (`team_size_required` when it has none); a blank colour or seed is none.
 */
export function createBody(form: TeamForm): Record<string, unknown> {
  const size = numberOrNull(form.size);
  const seed = numberOrNull(form.seed);
  return {
    name: form.name.trim(),
    ...(size != null ? { size } : {}),
    ...(form.color ? { color: form.color } : {}),
    ...(seed != null ? { seed } : {}),
  };
}

/** A save's body: every field, a blank colour or seed sent as null, which clears it. */
export function updateBody(form: TeamForm): Record<string, unknown> {
  const size = numberOrNull(form.size);
  return {
    name: form.name.trim(),
    // A team always has a size: a blank one is not sent, and the stored one stays.
    ...(size != null ? { size } : {}),
    color: form.color || null,
    seed: numberOrNull(form.seed),
  };
}

/** A team Tournament of the Event's list (`GET /events/:id/tournaments`), or null for another. */
export function teamTournamentOf(row: Record<string, unknown>): TeamTournament | null {
  if (row['entrant_kind'] !== 'team') return null;
  return {
    id: String(row['id']),
    name: String(row['name'] ?? ''),
    color: typeof row['color'] === 'string' ? row['color'] : null,
    teamDefaultSize: typeof row['team_default_size'] === 'number' ? row['team_default_size'] : null,
  };
}
