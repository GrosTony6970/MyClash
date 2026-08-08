/**
 * Raw readiness rows, folded into the snapshot the rules judge.
 *
 * Arithmetic, not opinion — which is exactly why it is a separate file from
 * `event-readiness.ts`. Nothing here decides whether an event is ready; it
 * decides what the rows SAY, and every judgement about what that means lives
 * next door. Split when the combined module outgrew the 400-line file budget,
 * along the seam the two test files had always assumed.
 *
 * Pure and dependency-free, so the foldings that carry real judgement are
 * testable without a Supabase mock chain.
 */
import type { ReadinessRosterSnapshot, ReadinessRows, ReadinessSnapshot } from './event-readiness';

/**
 * "Active" mirrors `countUniqueActiveFighters` and the dashboard's registered
 * total: a waitlisted, withdrawn or disqualified entry is not someone who will
 * step on a piste, so none of them count toward the two-fighter floor.
 */
const INACTIVE_REGISTRATION_STATUSES = new Set(['withdrawn', 'disqualified', 'waitlist']);

/**
 * Fold the raw rows into the per-tournament snapshot the rules run on.
 *
 * Pure, and separate from the query layer, because two of the foldings carry
 * real judgement worth testing without a Supabase mock:
 *
 * - **A pool counts as refereed via EITHER scope.** The assignment board
 *   writes `scope_type='pool'` for a whole pool and `scope_type='match'` for a
 *   single fight, and `clearPoolAssignments` treats both as belonging to the
 *   pool. Reading only pool-scoped rows would report an entirely match-refereed
 *   pool as unstaffed.
 *
 * - **A match is scheduled only with BOTH a piste and a time.** Either alone
 *   cannot be put on the board. Same predicate the organizer chat uses to list
 *   unscheduled matches.
 */
export function buildReadinessSnapshot(rows: ReadinessRows): ReadinessSnapshot {
  const { phaseTypesByTournament, tournamentByPhase } = indexPhases(rows.phases);
  const { tournamentByPool, poolIdsByTournament } = indexPools(rows.pools, tournamentByPhase);
  const swissRoundsByTournament = countByTournament(rows.swissRounds, tournamentByPhase);

  const refereedPoolIds = collectRefereedPoolIds(rows, tournamentByPool);
  const fighters = countActiveRegistrations(rows.registrations);
  const poolStats = summarisePoolMatches(rows.matches, tournamentByPool);

  return {
    liceCount: rows.liceCount,
    roster: summariseRosterQuality(rows),
    tournaments: rows.tournaments.map((tournament) => {
      const types = phaseTypesByTournament.get(tournament.id) ?? new Set<string>();
      const poolIds = poolIdsByTournament.get(tournament.id) ?? [];
      const stats = poolStats.get(tournament.id);
      return {
        id: tournament.id,
        name: tournament.name,
        rulesetCode: tournament.ruleset_code,
        activeFighterCount: fighters.get(tournament.id) ?? 0,
        hasPoolPhase: types.has('pool'),
        hasSwissPhase: types.has('swiss'),
        hasElimPhase: types.has('single_elim') || types.has('double_elim'),
        poolCount: poolIds.length,
        swissRoundCount: swissRoundsByTournament.get(tournament.id) ?? 0,
        poolsWithoutReferee: poolIds.filter((poolId) => !refereedPoolIds.has(poolId)).length,
        poolMatchCount: stats?.total ?? 0,
        unscheduledPoolMatchCount: stats?.unscheduled ?? 0,
      };
    }),
  };
}

function indexPhases(phases: ReadinessRows['phases']): {
  phaseTypesByTournament: Map<string, Set<string>>;
  tournamentByPhase: Map<string, string>;
} {
  const phaseTypesByTournament = new Map<string, Set<string>>();
  const tournamentByPhase = new Map<string, string>();
  for (const phase of phases) {
    tournamentByPhase.set(phase.id, phase.tournament_id);
    const types = phaseTypesByTournament.get(phase.tournament_id) ?? new Set<string>();
    types.add(phase.type);
    phaseTypesByTournament.set(phase.tournament_id, types);
  }
  return { phaseTypesByTournament, tournamentByPhase };
}

/** Count phase-scoped rows per tournament, via their phase. */
function countByTournament(
  rows: Array<{ phase_id: string }>,
  tournamentByPhase: Map<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const tournamentId = tournamentByPhase.get(row.phase_id);
    if (!tournamentId) continue;
    out.set(tournamentId, (out.get(tournamentId) ?? 0) + 1);
  }
  return out;
}

function indexPools(
  pools: ReadinessRows['pools'],
  tournamentByPhase: Map<string, string>,
): { tournamentByPool: Map<string, string>; poolIdsByTournament: Map<string, string[]> } {
  const tournamentByPool = new Map<string, string>();
  const poolIdsByTournament = new Map<string, string[]>();
  for (const pool of pools) {
    const tournamentId = tournamentByPhase.get(pool.phase_id);
    if (!tournamentId) continue;
    tournamentByPool.set(pool.id, tournamentId);
    poolIdsByTournament.set(tournamentId, [
      ...(poolIdsByTournament.get(tournamentId) ?? []),
      pool.id,
    ]);
  }
  return { tournamentByPool, poolIdsByTournament };
}

/** Pools with at least one live assignment, whether pool- or match-scoped. */
function collectRefereedPoolIds(
  rows: ReadinessRows,
  tournamentByPool: Map<string, string>,
): Set<string> {
  const poolByMatch = new Map<string, string>();
  for (const match of rows.matches) {
    if (match.pool_id && tournamentByPool.has(match.pool_id)) {
      poolByMatch.set(match.id, match.pool_id);
    }
  }
  const refereed = new Set<string>();
  for (const assignment of rows.refereeAssignments) {
    const poolId =
      assignment.pool_id ??
      (assignment.match_id ? poolByMatch.get(assignment.match_id) : undefined);
    if (poolId) refereed.add(poolId);
  }
  return refereed;
}

function countActiveRegistrations(
  registrations: ReadinessRows['registrations'],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const registration of registrations) {
    if (INACTIVE_REGISTRATION_STATUSES.has(registration.status ?? '')) continue;
    counts.set(registration.tournament_id, (counts.get(registration.tournament_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Roster quality over the people who will actually fight.
 *
 * Two intersections carry the meaning:
 *
 * - **Active registrations only.** `persons` is event-scoped and holds staff and
 *   instructors too. "12 people have no club" is a lie if four of them are
 *   volunteers, and an organiser who chases those four once stops trusting the
 *   row.
 *
 * - **Distinct PEOPLE, not registrations.** A fighter entered in longsword and
 *   rapier is one person with one club; counting registrations would double
 *   every gap and make the numbers move when a tournament is added.
 *
 * The rating is read from the local row OR the linked global identity. Those are
 * two places the same fact can live — `persons.hema_ratings_id` is what an
 * importer writes, `global_persons.hema_ratings_id` is what a claimed profile
 * carries — and reporting a rated fighter as unrated because the id sits on the
 * other row would be a false gap.
 */
function summariseRosterQuality(rows: ReadinessRows): ReadinessRosterSnapshot {
  const activeIds = new Set<string>();
  for (const registration of rows.registrations) {
    if (INACTIVE_REGISTRATION_STATUSES.has(registration.status ?? '')) continue;
    activeIds.add(registration.person_id);
  }

  const snapshot: ReadinessRosterSnapshot = {
    activeFighterCount: 0,
    withoutClub: 0,
    withoutRatingsId: 0,
    withoutGlobalIdentity: 0,
  };

  for (const person of rows.persons) {
    if (!activeIds.has(person.id)) continue;
    snapshot.activeFighterCount += 1;
    if (!person.club_id) snapshot.withoutClub += 1;
    if (!person.global_person_id) snapshot.withoutGlobalIdentity += 1;
    const rating = person.hema_ratings_id?.trim() || person.global_persons?.hema_ratings_id?.trim();
    if (!rating) snapshot.withoutRatingsId += 1;
  }

  return snapshot;
}

function summarisePoolMatches(
  matches: ReadinessRows['matches'],
  tournamentByPool: Map<string, string>,
): Map<string, { total: number; unscheduled: number }> {
  const stats = new Map<string, { total: number; unscheduled: number }>();
  for (const match of matches) {
    const tournamentId = match.pool_id ? tournamentByPool.get(match.pool_id) : undefined;
    if (!tournamentId) continue; // bracket match, or a pool outside this event
    const entry = stats.get(tournamentId) ?? { total: 0, unscheduled: 0 };
    entry.total += 1;
    if (!match.lice_id || !match.scheduled_at) entry.unscheduled += 1;
    stats.set(tournamentId, entry);
  }
  return stats;
}
