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
 * The FOLDING — raw rows into the snapshot these rules judge — lives next door
 * in `event-readiness-snapshot.ts`. The two were one file until it outgrew the
 * 400-line budget, and the seam was already there: this file holds opinions
 * about when an event is ready, that one holds arithmetic about what the rows
 * say. Their tests have always been separate for the same reason.
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
  hasSwissPhase: boolean;
  hasElimPhase: boolean;
  poolCount: number;
  /** Rounds GENERATED so far, not the configured total. */
  swissRoundCount: number;
  /** Pools with no `referee_assignments` row. */
  poolsWithoutReferee: number;
  /** Matches belonging to a pool of this tournament. */
  poolMatchCount: number;
  /** Pool matches missing `lice_id` OR `scheduled_at` — both are required. */
  unscheduledPoolMatchCount: number;
}

/**
 * Roster QUALITY, as opposed to the structural counts above.
 *
 * Every other snapshot field asks "does the event have the pieces it needs to
 * run" — tournaments, pools, pistes, referees. This asks "is what we know about
 * the people any good", which is a different question with a different deadline:
 * structure can be fixed on the morning, but a fighter whose identity never
 * resolved has already lost their stats, and chasing a club affiliation on the
 * day is nobody's job.
 *
 * EVENT-level rather than per tournament. `persons` is event-scoped and a
 * fighter entered in two weapons is one person with one club and one rating, so
 * per-tournament rows would report the same gap twice and imply it could be
 * fixed in one tournament but not the other.
 *
 * The population is fighters with an ACTIVE registration, not every `persons`
 * row: the event roster also carries staff-only and instructor rows, and
 * "12 people have no club" is a lie if four of them are volunteers.
 */
export interface ReadinessRosterSnapshot {
  /** Distinct people holding at least one active registration. */
  activeFighterCount: number;
  /** …of those, how many have no `club_id`. */
  withoutClub: number;
  /** …how many have no HEMA Ratings id, locally or on their global identity. */
  withoutRatingsId: number;
  /** …how many never resolved to a `global_persons` row. */
  withoutGlobalIdentity: number;
}

export interface ReadinessSnapshot {
  /** `lices` rows for the event (pistes). */
  liceCount: number;
  tournaments: ReadinessTournamentSnapshot[];
  roster: ReadinessRosterSnapshot;
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
  /**
   * `person_id` is what makes roster quality answerable without a second query
   * — the service has always fetched it, the type simply did not say so.
   */
  registrations: Array<{ tournament_id: string; person_id: string; status: string | null }>;
  /**
   * The event's `persons` rows. Includes staff-only and instructor entries, so
   * the fold intersects with active registrations before concluding anything.
   *
   * Empty when the event has no tournaments: with nothing to register for there
   * are no active fighters, so the roster-quality rows would be vacuous and the
   * service skips the query entirely rather than paying for an answer no rule
   * will read.
   */
  persons: Array<{
    id: string;
    club_id: string | null;
    hema_ratings_id: string | null;
    global_person_id: string | null;
    /** The linked global identity's rating id, when there is one. */
    global_persons: { hema_ratings_id: string | null } | null;
  }>;
  phases: Array<{ id: string; tournament_id: string; type: string }>;
  pools: Array<{ id: string; phase_id: string }>;
  /** Swiss rounds GENERATED so far, keyed to their phase. */
  swissRounds: Array<{ id: string; phase_id: string }>;
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
 * Severity order for `worst`. `info` sits BELOW `ok`: an event whose only
 * non-ok rows are informational is in better shape than one with real
 * outstanding work, and the header chip should read green, not blue.
 */
const SEVERITY: Record<ReadinessLevel, number> = { info: 0, ok: 1, warn: 2, critical: 3 };

/** Compute the full readiness checklist for an event. */
export function computeEventReadiness(snapshot: ReadinessSnapshot): ReadinessReport {
  const checks: ReadinessCheck[] = [
    ...eventLevelChecks(snapshot),
    ...rosterQualityChecks(snapshot.roster),
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

/**
 * What we know about the people, as opposed to whether the event has its pieces.
 *
 * All three are OMITTED entirely when nobody has an active registration. With an
 * empty roster "everyone has a club" is trivially true, and reporting it green
 * is the false all-clear the module docstring exists to prevent.
 *
 * The levels differ on one question: is the gap a DEFECT or a fact about the
 * world?
 *
 * - `rosterIdentity` WARNS. A roster row that never resolved to a global person
 *   is a failure, not a state — `createPerson` links every participant and the
 *   only path that leaves it null is the CSV importer swallowing a resolver
 *   error. The cost is invisible and permanent: that fighter's results never
 *   reach their profile, their career page, or any league standing. Rare, and
 *   worth interrupting for.
 *
 * - `rosterClub` and `rosterRatings` stay at `info`, which sits BELOW `ok` in
 *   SEVERITY and therefore never moves the header chip or reaches the publish
 *   dialog. An unaffiliated fighter is a real and legitimate thing to be, and an
 *   unrated one is simply new. Registration is open for weeks; a roster that
 *   read amber the whole time would train the organiser to ignore the panel,
 *   which is the failure this whole module is written to avoid.
 */
function rosterQualityChecks(roster: ReadinessRosterSnapshot): ReadinessCheck[] {
  if (roster.activeFighterCount === 0) return [];

  const at = (key: string, missing: number, level: ReadinessLevel): ReadinessCheck => ({
    key,
    level: missing > 0 ? level : 'ok',
    values: { missing, total: roster.activeFighterCount },
    tournamentId: null,
  });

  return [
    at('rosterIdentity', roster.withoutGlobalIdentity, 'warn'),
    at('rosterClub', roster.withoutClub, 'info'),
    at('rosterRatings', roster.withoutRatingsId, 'info'),
  ];
}

function tournamentChecks(tournament: ReadinessTournamentSnapshot): ReadinessCheck[] {
  const at = (check: Omit<ReadinessCheck, 'tournamentId'>): ReadinessCheck => ({
    ...check,
    tournamentId: tournament.id,
  });
  // Swiss counts as a FORMAT. Without it a Swiss-only tournament reported
  // "no format chosen" and short-circuited every downstream check below.
  const hasFormat = tournament.hasPoolPhase || tournament.hasSwissPhase || tournament.hasElimPhase;

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
  // Omitted, not reported green, when there is no Swiss phase — a vacuous
  // check is worse than no check (see the module docstring).
  if (tournament.hasSwissPhase) checks.push(swissRoundsCheck(tournament, at));
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

/**
 * How many Swiss rounds exist so far.
 *
 * Never exceeds `info`: rounds are generated one at a time as the phase runs,
 * so "only round 1 exists" is the normal state on the morning of the event, not
 * a gap for the organiser to close.
 */
function swissRoundsCheck(
  tournament: ReadinessTournamentSnapshot,
  at: AtTournament,
): ReadinessCheck {
  return at({
    key: 'swissRounds',
    level: 'info',
    values: { rounds: tournament.swissRoundCount },
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
