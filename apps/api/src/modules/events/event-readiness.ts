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
      level: tournament.rulesetCode?.trim() ? 'ok' : 'warn',
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
