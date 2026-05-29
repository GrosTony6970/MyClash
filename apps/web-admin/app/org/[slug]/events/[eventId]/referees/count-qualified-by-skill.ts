/**
 * Build a Map<skillId, count> from the event's referee roster — used by
 * the Referees-tab table header to show how many referees are currently
 * qualified for each role (Déclarant / Assesseur / Table / custom).
 *
 * "Qualified" = has a non-null rating for that skill. An entry with
 * `rating === null` is a tracked-but-unrated row (e.g. operator added
 * the skill but hasn't given a level yet) and is NOT counted.
 */

interface RefereeQualification {
  skillId: string;
  rating: number | null;
}

interface RefereeRow {
  qualifications: RefereeQualification[];
}

export function countQualifiedBySkill(referees: RefereeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of referees) {
    for (const q of r.qualifications) {
      if (q.rating == null) continue;
      map.set(q.skillId, (map.get(q.skillId) ?? 0) + 1);
    }
  }
  return map;
}
