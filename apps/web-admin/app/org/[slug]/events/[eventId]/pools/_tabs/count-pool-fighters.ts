export interface MatchWithRegs {
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

/**
 * Distinct fighter count across a pool's matches. Each fighter
 * plays every other in the pool (Berger round-robin), so the set
 * of unique registration ids across all matches' red/blue slots
 * equals the pool's member count. Null ids (bye / unseeded slot)
 * are skipped.
 */
export function countPoolFighters(matches: MatchWithRegs[]): number {
  const ids = new Set<string>();
  for (const m of matches) {
    if (m.red_registration_id) ids.add(m.red_registration_id);
    if (m.blue_registration_id) ids.add(m.blue_registration_id);
  }
  return ids.size;
}
