/**
 * Club / team standings, aggregated at read time from `league_rankings` — no
 * new table. A club's total is the sum of all its members' `total_points`,
 * ranked descending; ties break by member count then medal count. A fighter's
 * club is `global_persons.club_id`; club-less fighters collect into a separate
 * "Unaffiliated" bucket that is excluded from the ranked clubs.
 */
type Row = Record<string, unknown>;

export interface ClubStandingMember {
  fighterId: string;
  name: string;
  points: number;
}

export interface ClubStandingRow {
  clubId: string;
  name: string;
  city: string | null;
  totalPoints: number;
  memberCount: number;
  medalCount: number;
  topMembers: ClubStandingMember[];
}

export interface UnaffiliatedBucket {
  totalPoints: number;
  memberCount: number;
  medalCount: number;
}

interface ClubAccumulator {
  clubId: string;
  name: string;
  city: string | null;
  totalPoints: number;
  medalCount: number;
  members: Map<string, ClubStandingMember>;
}

const TOP_MEMBERS_LIMIT = 3;

/**
 * PostgREST returns a to-one embed as an object, but a UNIQUE constraint on the
 * FK can flip it to a one-element array — normalize both to the object (or null).
 */
function embedObject(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  if (value && typeof value === 'object') return value as Row;
  return null;
}

/**
 * Fold `league_rankings` rows (each carrying the fighter's `global_persons`
 * embed with its `clubs` join) into ranked club rows plus one unaffiliated
 * bucket. A fighter with rows in several ranking groups contributes each row's
 * points to their club but is counted once toward `memberCount`.
 */
export function aggregateClubStandings(rows: Row[]): {
  clubs: ClubStandingRow[];
  unaffiliated: UnaffiliatedBucket | null;
} {
  const byClub = new Map<string, ClubAccumulator>();
  const unaffiliatedMembers = new Set<string>();
  let unaffiliatedPoints = 0;
  let unaffiliatedMedals = 0;
  let unaffiliatedRows = 0;

  for (const row of rows) {
    const points = Number(row['total_points'] ?? 0);
    const medals = Number(row['medal_count'] ?? 0);
    const fighterId = String(row['global_person_id'] ?? '');
    const person = embedObject(row['global_persons']);
    const club = person ? embedObject(person['clubs']) : null;
    const clubId = club ? String(club['id'] ?? '') : '';
    const displayName =
      person && typeof person['display_name'] === 'string' ? person['display_name'].trim() : '';
    const fighterName = displayName || fighterId;

    if (!clubId) {
      unaffiliatedPoints += points;
      unaffiliatedMedals += medals;
      unaffiliatedRows += 1;
      if (fighterId) unaffiliatedMembers.add(fighterId);
      continue;
    }

    const acc: ClubAccumulator = byClub.get(clubId) ?? {
      clubId,
      name: String(club!['name'] ?? ''),
      city: (club!['city'] as string | null) ?? null,
      totalPoints: 0,
      medalCount: 0,
      members: new Map<string, ClubStandingMember>(),
    };
    acc.totalPoints += points;
    acc.medalCount += medals;
    if (fighterId) {
      const member = acc.members.get(fighterId) ?? { fighterId, name: fighterName, points: 0 };
      member.points += points;
      acc.members.set(fighterId, member);
    }
    byClub.set(clubId, acc);
  }

  const clubs: ClubStandingRow[] = [...byClub.values()]
    .map((acc) => ({
      clubId: acc.clubId,
      name: acc.name,
      city: acc.city,
      totalPoints: acc.totalPoints,
      memberCount: acc.members.size,
      medalCount: acc.medalCount,
      topMembers: [...acc.members.values()]
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
        .slice(0, TOP_MEMBERS_LIMIT),
    }))
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.memberCount - a.memberCount ||
        b.medalCount - a.medalCount ||
        a.name.localeCompare(b.name),
    );

  const unaffiliated: UnaffiliatedBucket | null =
    unaffiliatedRows > 0
      ? {
          totalPoints: unaffiliatedPoints,
          memberCount: unaffiliatedMembers.size,
          medalCount: unaffiliatedMedals,
        }
      : null;

  return { clubs, unaffiliated };
}
