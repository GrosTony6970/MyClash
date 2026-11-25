import { sideKey } from '@myclash/types/side-key';

/** A Pool bout's two sides as the view sends them: a Registration or a team each (0284). */
export interface MatchWithSides {
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id: string | null;
  blue_team_id: string | null;
}

/**
 * Distinct entrant count across a pool's matches: Fighters in an individual Pool, teams in a team
 * Pool. Each entrant plays every other in the pool (Berger round-robin), so the set of side keys
 * across all matches' red/blue sides equals the pool's member count. A side not known yet (bye /
 * unseeded slot) is skipped.
 */
export function countPoolFighters(matches: MatchWithSides[]): number {
  const ids = new Set<string>();
  for (const m of matches) {
    for (const id of [
      sideKey(m.red_registration_id, m.red_team_id),
      sideKey(m.blue_registration_id, m.blue_team_id),
    ]) {
      if (id) ids.add(id);
    }
  }
  return ids.size;
}

/** Whether a Pool's bouts are fought by teams: then its count names teams, not Fighters. */
export function isTeamPool(matches: MatchWithSides[]): boolean {
  return matches.some((m) => Boolean(m.red_team_id || m.blue_team_id));
}
