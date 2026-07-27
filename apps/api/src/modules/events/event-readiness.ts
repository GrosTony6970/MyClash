/**
 * Event readiness pre-flight — the judgement layer over the dashboard's counts.
 *
 * The dashboard already knows how many fighters, referees and pools an event
 * has. It never concludes anything from them. This module turns those numbers
 * into a checklist an organiser can read the night before: what is missing,
 * how badly, and on which tournament.
 *
 * Pure and dependency-free on purpose. Every rule here is an OPINION about
 * when an event is ready to run, not a fact the database states, so it needs
 * to be unit-testable without a Supabase mock chain.
 *
 * ── Rules that are not obvious ──────────────────────────────────────────────
 *
 * - **Readiness warns, it never blocks.** Publishing an event before referees
 *   are assigned is legitimate — organisers publish to open registration long
 *   before staffing exists. The publish flow surfaces these checks and still
 *   offers "publish anyway".
 *
 * - **The bracket row can never exceed `info`.** Brackets are populated from
 *   pool standings after pools finish, typically on day two — `populateBracket`
 *   is gated on pool completion. An empty bracket on day one is the designed
 *   state, so flagging it would train the organiser to ignore the panel.
 *
 * - **Vacuous checks are omitted, not reported green.** With zero pools,
 *   "every pool has a referee" is trivially true; reporting it as `ok` would be
 *   a false all-clear. `poolReferees` and `schedule` are only emitted once
 *   there is something for them to be about — the `pools` / `format` rows
 *   already say what is missing underneath.
 */

export type ReadinessLevel = 'ok' | 'warn' | 'critical' | 'info';

export interface ReadinessCheck {
  /** Stable identifier — drives the i18n key and the FE deep link. */
  key: string;
  level: ReadinessLevel;
  /** Interpolation values for the i18n message (counts, names). */
  values?: Record<string, string | number>;
  /** `null` for event-level checks. */
  tournamentId: string | null;
}

export interface ReadinessTournamentSnapshot {
  id: string;
  name: string;
  /** `tournaments.ruleset_code`. */
  rulesetCode: string | null;
  /** Registrations excluding waitlist / withdrawn / disqualified. */
  activeFighterCount: number;
  hasPoolPhase: boolean;
  hasElimPhase: boolean;
  poolCount: number;
  /** Pools with no `referee_assignments` row. */
  poolsWithoutReferee: number;
  /** Matches belonging to a pool of this tournament. */
  poolMatchCount: number;
  /** Pool matches missing `lice_id` OR `scheduled_at` — both are required. */
  unscheduledPoolMatchCount: number;
}

export interface ReadinessSnapshot {
  /** `lices` rows for the event (pistes). */
  liceCount: number;
  tournaments: ReadinessTournamentSnapshot[];
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  worst: ReadinessLevel;
  counts: Record<ReadinessLevel, number>;
}

/** Raw rows as the service reads them, before they mean anything. */
export interface ReadinessRows {
  liceCount: number;
  tournaments: Array<{ id: string; name: string; ruleset_code: string | null }>;
  registrations: Array<{ tournament_id: string; status: string | null }>;
  phases: Array<{ id: string; tournament_id: string; type: string }>;
  pools: Array<{ id: string; phase_id: string }>;
  /** Matches of the event's phases — pool membership is read from `pool_id`. */
  matches: Array<{
    id: string;
    pool_id: string | null;
    lice_id: string | null;
    scheduled_at: string | null;
  }>;
  /** Live referee assignments (pool- or match-scoped) for the event. */
  refereeAssignments: Array<{ pool_id: string | null; match_id: string | null }>;
}

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

  const refereedPoolIds = collectRefereedPoolIds(rows, tournamentByPool);
  const fighters = countActiveRegistrations(rows.registrations);
  const poolStats = summarisePoolMatches(rows.matches, tournamentByPool);

  return {
    liceCount: rows.liceCount,
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
        hasElimPhase: types.has('single_elim') || types.has('double_elim'),
        poolCount: poolIds.length,
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

/**
 * Severity order for `worst`. `info` sits BELOW `ok`: an event whose only
 * non-ok rows are informational is in better shape than one with real
 * outstanding work, and the header chip should read green, not blue.
 */
const SEVERITY: Record<ReadinessLevel, number> = { info: 0, ok: 1, warn: 2, critical: 3 };

/** Compute the full readiness checklist for an event. */
export function computeEventReadiness(snapshot: ReadinessSnapshot): ReadinessReport {
  const checks: ReadinessCheck[] = [
    ...eventLevelChecks(snapshot),
    ...snapshot.tournaments.flatMap((tournament) => tournamentChecks(tournament)),
  ];
  return { checks, worst: worstLevel(checks), counts: countByLevel(checks) };
}

function eventLevelChecks(snapshot: ReadinessSnapshot): ReadinessCheck[] {
  const tournamentCount = snapshot.tournaments.length;
  return [
    {
      key: 'tournaments',
      level: tournamentCount === 0 ? 'critical' : 'ok',
      values: { count: tournamentCount },
      tournamentId: null,
    },
    {
      key: 'pistes',
      // Nullable everywhere — a match scores fine with `lice_id` NULL — but
      // with no pistes the schedule board has no columns, so nothing can ever
      // be given a time and a place. Warn, not critical.
      level: snapshot.liceCount === 0 ? 'warn' : 'ok',
      values: { count: snapshot.liceCount },
      tournamentId: null,
    },
  ];
}

function tournamentChecks(tournament: ReadinessTournamentSnapshot): ReadinessCheck[] {
  const at = (check: Omit<ReadinessCheck, 'tournamentId'>): ReadinessCheck => ({
    ...check,
    tournamentId: tournament.id,
  });
  const hasFormat = tournament.hasPoolPhase || tournament.hasElimPhase;

  const checks: ReadinessCheck[] = [
    at({
      key: 'ruleset',
      // Reports WHICH ruleset will score the fights; it does not gate.
      // `tournaments.ruleset_code` is TEXT NOT NULL DEFAULT 'TF_v1' and every
      // custom-ruleset pin writes its code into that same column, so "no
      // ruleset" is unreachable — a warn here would be a row that claims to
      // check something it cannot. The blank branch is kept only as a guard
      // against the column becoming nullable later.
      level: tournament.rulesetCode?.trim() ? 'info' : 'warn',
      values: { ruleset: tournament.rulesetCode?.trim() ?? '' },
    }),
    at({
      key: 'fighters',
      // Below 2, nothing can be generated at all: bracket generation rejects
      // it outright and Berger pool scheduling throws.
      level: tournament.activeFighterCount < 2 ? 'critical' : 'ok',
      values: { count: tournament.activeFighterCount },
    }),
  ];

  if (!hasFormat) {
    checks.push(at({ key: 'format', level: 'warn' }));
    return checks;
  }

  checks.push(poolsCheck(tournament, at));
  if (tournament.poolCount > 0) checks.push(poolRefereesCheck(tournament, at));
  if (tournament.poolMatchCount > 0) checks.push(scheduleCheck(tournament, at));
  if (tournament.hasElimPhase) {
    // Never exceeds `info` — see the module docstring.
    checks.push(at({ key: 'bracket', level: 'info' }));
  }
  return checks;
}

type AtTournament = (check: Omit<ReadinessCheck, 'tournamentId'>) => ReadinessCheck;

function poolsCheck(tournament: ReadinessTournamentSnapshot, at: AtTournament): ReadinessCheck {
  // No pool phase but an elim phase exists: the tournament goes straight to
  // the bracket. That is a valid format, not a gap.
  if (!tournament.hasPoolPhase) return at({ key: 'pools', level: 'info' });
  return at({
    key: 'pools',
    level: tournament.poolCount === 0 ? 'warn' : 'ok',
    values: { count: tournament.poolCount },
  });
}

function poolRefereesCheck(
  tournament: ReadinessTournamentSnapshot,
  at: AtTournament,
): ReadinessCheck {
  return at({
    key: 'poolReferees',
    level: tournament.poolsWithoutReferee > 0 ? 'warn' : 'ok',
    values: { missing: tournament.poolsWithoutReferee, total: tournament.poolCount },
  });
}

function scheduleCheck(tournament: ReadinessTournamentSnapshot, at: AtTournament): ReadinessCheck {
  return at({
    key: 'schedule',
    level: tournament.unscheduledPoolMatchCount > 0 ? 'warn' : 'ok',
    values: {
      unscheduled: tournament.unscheduledPoolMatchCount,
      total: tournament.poolMatchCount,
    },
  });
}

function worstLevel(checks: ReadinessCheck[]): ReadinessLevel {
  let worst: ReadinessLevel = 'ok';
  for (const check of checks) {
    if (SEVERITY[check.level] > SEVERITY[worst]) worst = check.level;
  }
  return worst;
}

function countByLevel(checks: ReadinessCheck[]): Record<ReadinessLevel, number> {
  const counts: Record<ReadinessLevel, number> = { ok: 0, warn: 0, critical: 0, info: 0 };
  for (const check of checks) counts[check.level] += 1;
  return counts;
}
