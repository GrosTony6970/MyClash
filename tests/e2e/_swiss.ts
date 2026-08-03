import { sleep, type Api } from './_api';
import { POINT_CAP, scoreMatch, type Person } from './_bracket';

/**
 * Helpers for playing a Swiss phase end to end over the real API.
 *
 * Swiss is the one format where the driver cannot walk a structure: there is no
 * bracket, no slot graph, and above all ROUND N+1 DOES NOT EXIST until round N
 * is scored. `SwissAdvanceService.onMatchCompleted` pairs it, invoked from
 * `MatchCompletionService` — fire-and-forget, inside a try/catch that swallows,
 * because a completion side effect must never fail the exchange that triggered
 * it. So a broken advance edge produces NO error anywhere: the tournament simply
 * stops after round 1 and waits forever. That is the double-elim `source_a_ref`
 * failure mode again, and it is why this needs a real playthrough rather than a
 * mocked unit test.
 *
 * Two more things only real rows exercise:
 *   - the DI graph. `SwissCoreModule` is a leaf precisely so `PhasesModule` can
 *     import it for auto-advance without closing a cycle; a Nest module cycle is
 *     invisible to tsc AND to vitest (esbuild emits no decorator metadata) and
 *     surfaces only when the API boots. Hitting these endpoints on a deployed
 *     API is what proves the graph resolves.
 *   - `swiss_rounds UNIQUE (phase_id, round_number)`, the idempotency backstop
 *     for two near-simultaneous completions both seeing "round complete".
 *
 * Matches are played the way the pad plays them — clean exchanges until the
 * engine trips `first_to_points` — reusing `scoreMatch` from `_bracket.ts`. An
 * earlier bracket spec declared winners with `PATCH /matches/:id/status`, a door
 * no frontend opens, and for a while that was the only path that advanced
 * anything. Swiss inherits the same lesson: the pad's completion is what has to
 * trigger the next round.
 *
 * Deliberately free of workspace-package imports, matching the convention the
 * rest of `tests/e2e` documents — the e2e runner resolves them poorly.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** One bout of `GET /tournaments/:id/swiss`. */
export interface SwissMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  redRegistrationId: string | null;
  redFighterName: string | null;
  redScore: number | null;
  blueRegistrationId: string | null;
  blueFighterName: string | null;
  blueScore: number | null;
  winnerRegistrationId: string | null;
  liceName: string | null;
}

export interface SwissWarning {
  code: 'forced-rematch' | 'no-perfect-matching' | 'singleton-band';
  registrationIds: string[];
}

export interface SwissRound {
  id: string;
  roundNumber: number;
  status: string;
  warnings: SwissWarning[];
  byeRegistrationId: string | null;
  byeFighterName: string | null;
  manuallyAdjusted: boolean;
  matches: SwissMatch[];
}

export interface SwissRounds {
  phaseId: string | null;
  roundCount: number;
  roundsCompleted: number;
  finalized: { atRound: number; at: string } | null;
  rounds: SwissRound[];
}

export interface SwissStandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  status: string;
  stats: Record<string, number | string>;
  withdrawn: boolean;
  withdrawnAtRound: number | null;
}

export interface SwissStandings {
  phaseId: string | null;
  columns: Array<{ key: string; label: string }>;
  rankBy: 'swissPts' | 'rulesetScore';
  tiebreakChain: string[];
  roundsCompleted: number;
  roundCount: number;
  rows: SwissStandingsRow[];
}

/** One round of `GET /tournaments/:id/swiss-admin` — carries the validity. */
export interface SwissAdminRound {
  id: string;
  roundNumber: number;
  status: string;
  validity: { valid: boolean; duplicated: string[]; missing: string[]; unknown: string[] };
}

export interface SwissAdminView {
  phaseId: string | null;
  config: {
    roundCount: number;
    points: { win: number; draw: number; loss: number; bye: number };
  } | null;
  registeredCount: number;
  recommendedRoundCount: number;
  entrants: Array<{ registrationId: string; personName: string; withdrawnAtRound: number | null }>;
  rounds: SwissAdminRound[];
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const readSwiss = async (api: Api, tournamentId: string): Promise<SwissRounds> =>
  api.json<SwissRounds>(await api.get(`tournaments/${tournamentId}/swiss`));

export const readSwissStandings = async (api: Api, tournamentId: string): Promise<SwissStandings> =>
  api.json<SwissStandings>(await api.get(`tournaments/${tournamentId}/swiss-standings`));

export const readSwissAdmin = async (api: Api, tournamentId: string): Promise<SwissAdminView> =>
  api.json<SwissAdminView>(await api.get(`tournaments/${tournamentId}/swiss-admin`));

// ── Seeds ────────────────────────────────────────────────────────────────────

/**
 * registrationId → seed number, parsed from the shared `Seed NN` roster.
 *
 * The driver needs a deterministic winner rule and the round-1 draw is RANDOM by
 * default, so "who plays whom" differs per run. Making the lower seed always win
 * gives reproducible OUTCOMES without needing a reproducible draw: seed 1 is
 * unbeaten in every run, whoever they happened to be drawn against.
 */
export function seedByRegistration(
  personByRegistrationId: Map<string, Person>,
): Map<string, number> {
  const seeds = new Map<string, number>();
  for (const [registrationId, person] of personByRegistrationId) {
    seeds.set(registrationId, Number(person.familyName));
  }
  return seeds;
}

// ── Driver ───────────────────────────────────────────────────────────────────

export interface SwissPlayResult {
  /** Bouts this driver completed. */
  played: number;
  /** Rounds that were paired and scored. */
  roundsPlayed: number;
  /** The phase as it stands after play. */
  swiss: SwissRounds;
  /** Set when the run stopped early; empty string on a clean finish. */
  stallReport: string;
}

/**
 * Play a Swiss phase from wherever it currently stands: score every unfinished
 * bout of the latest round, wait for the next one to pair ITSELF, repeat until
 * the configured round count is reached.
 *
 * The wait is the assertion this driver exists for. It is a poll, not a sleep:
 * advancement is fire-and-forget, so the next round appears some time after the
 * final exchange POST returns. When the budget runs out and no new round has
 * appeared, that IS the bug — reported with the round that never came rather
 * than as a timeout on some later assertion about missing data.
 */
export async function playSwiss(
  api: Api,
  tournamentId: string,
  seeds: Map<string, number>,
  opts: { pointCap?: number; settleTries?: number; settleDelayMs?: number } = {},
): Promise<SwissPlayResult> {
  const pointCap = opts.pointCap ?? POINT_CAP;
  let swiss = await readSwiss(api, tournamentId);
  let played = 0;

  // RESUMABLE by design: it sequences on the latest round NUMBER and skips
  // bouts that are already completed, rather than counting from 1. A caller
  // that scored round 1 by hand — to withdraw someone who fought in it, or to
  // set up a rematch swap in round 2 — hands over mid-phase, and a driver that
  // assumed it always started at the beginning would report that as a stall.
  for (;;) {
    const round = swiss.rounds[swiss.rounds.length - 1];
    if (!round) {
      return {
        played,
        roundsPlayed: 0,
        swiss,
        stallReport: 'the phase has no rounds at all — generation did not pair round 1',
      };
    }

    for (const match of round.matches) {
      if (match.status === 'completed') continue;
      played += 1;
      await scoreMatch(api, match.id, winnerColorFor(match, seeds), pointCap);
    }
    if (round.roundNumber >= swiss.roundCount) {
      return {
        played,
        roundsPlayed: round.roundNumber,
        swiss: await readSwiss(api, tournamentId),
        stallReport: '',
      };
    }

    const next = await settleNextRound(
      api,
      tournamentId,
      round.roundNumber + 1,
      opts.settleTries ?? 20,
      opts.settleDelayMs ?? 750,
    );
    if (!next) {
      return {
        played,
        roundsPlayed: round.roundNumber,
        swiss: await readSwiss(api, tournamentId),
        stallReport:
          `round ${round.roundNumber} finished but round ${round.roundNumber + 1} never ` +
          `appeared. SwissAdvanceService.onMatchCompleted swallows its own errors, so check ` +
          `the API log for "swiss auto-advance ... failed" — and check that PhasesModule ` +
          `still imports SwissCoreModule.`,
      };
    }
    swiss = next;
  }
}

/** Which side the lower seed is on — the deterministic winner. */
function winnerColorFor(match: SwissMatch, seeds: Map<string, number>): 'red' | 'blue' {
  const red = seeds.get(match.redRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  const blue = seeds.get(match.blueRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return red <= blue ? 'red' : 'blue';
}

/** Poll until `roundNumber` has been paired by the auto-advance, or give up. */
async function settleNextRound(
  api: Api,
  tournamentId: string,
  roundNumber: number,
  tries: number,
  delayMs: number,
): Promise<SwissRounds | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const swiss = await readSwiss(api, tournamentId);
    if (swiss.rounds.some((round) => round.roundNumber === roundNumber)) return swiss;
    await sleep(delayMs);
  }
  return null;
}

// ── Invariant checks ─────────────────────────────────────────────────────────

export interface SwissViolation {
  round: number;
  detail: string;
}

/**
 * Every structural rule a Swiss phase owes, checked against the played rounds.
 *
 * Returns violations rather than asserting, so a spec can report them all at
 * once — a pairing bug usually breaks the same rule in several rounds and one
 * failed assertion per run makes that take four runs to see.
 */
export function swissViolations(swiss: SwissRounds, entrantCount: number): SwissViolation[] {
  const violations: SwissViolation[] = [];
  const seen = new Map<string, Set<string>>();
  const byeCount = new Map<string, number>();

  for (const round of swiss.rounds) {
    const appearances = new Map<string, number>();
    const note = (id: string | null) => {
      if (!id) return;
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
    };

    for (const match of round.matches) {
      note(match.redRegistrationId);
      note(match.blueRegistrationId);

      const red = match.redRegistrationId;
      const blue = match.blueRegistrationId;
      if (!red || !blue) {
        violations.push({ round: round.roundNumber, detail: `bout ${match.id} has an empty side` });
        continue;
      }
      // A rematch is legal ONLY when the engine says no legal alternative
      // existed — and it says so publicly, which is decision 16's whole point.
      const forced = round.warnings.some(
        (warning) =>
          warning.code === 'forced-rematch' &&
          warning.registrationIds.includes(red) &&
          warning.registrationIds.includes(blue),
      );
      if (!forced && seen.get(red)?.has(blue)) {
        violations.push({
          round: round.roundNumber,
          detail: `unflagged rematch: ${match.redFighterName} vs ${match.blueFighterName}`,
        });
      }
      if (!seen.has(red)) seen.set(red, new Set());
      if (!seen.has(blue)) seen.set(blue, new Set());
      seen.get(red)!.add(blue);
      seen.get(blue)!.add(red);
    }

    note(round.byeRegistrationId);
    if (round.byeRegistrationId) {
      byeCount.set(round.byeRegistrationId, (byeCount.get(round.byeRegistrationId) ?? 0) + 1);
    }

    const twice = [...appearances.entries()].filter(([, count]) => count > 1);
    if (twice.length > 0) {
      violations.push({
        round: round.roundNumber,
        detail: `fighter(s) appear more than once: ${twice.map(([id]) => id).join(', ')}`,
      });
    }
    // An odd field gets exactly one bye; an even field gets none.
    const expectedByes = entrantCount % 2 === 1 ? 1 : 0;
    const actualByes = round.byeRegistrationId ? 1 : 0;
    if (actualByes !== expectedByes) {
      violations.push({
        round: round.roundNumber,
        detail: `expected ${expectedByes} bye for a field of ${entrantCount}, got ${actualByes}`,
      });
    }
    if (appearances.size !== entrantCount) {
      violations.push({
        round: round.roundNumber,
        detail: `${appearances.size} of ${entrantCount} entrants were dealt into the round`,
      });
    }
  }

  // Nobody sits out twice while someone else has never sat out. Only checkable
  // once the phase is short enough that the bye pool has not been exhausted.
  if (swiss.rounds.length <= entrantCount) {
    for (const [registrationId, count] of byeCount) {
      if (count > 1) {
        violations.push({ round: 0, detail: `${registrationId} took ${count} byes` });
      }
    }
  }
  return violations;
}

/**
 * Buchholz recomputed from the rounds, independently of the server.
 *
 * The point of checking it here rather than trusting the standings: Buchholz is
 * the sum of every OPPONENT's Swiss points, so it is the one column that cannot
 * be right by accident — it only agrees if the opponent lists and the points
 * arithmetic are both right.
 *
 * A bye contributes 0, deliberately (FIDE's virtual-opponent rule is a
 * documented v1 omission), so this mirrors that and does not "fix" it.
 */
export function expectedBuchholz(
  swiss: SwissRounds,
  points: { win: number; draw: number; loss: number; bye: number },
): { swissPts: Map<string, number>; buchholz: Map<string, number> } {
  const swissPts = new Map<string, number>();
  const opponents = new Map<string, string[]>();
  const add = (id: string, value: number) => swissPts.set(id, (swissPts.get(id) ?? 0) + value);

  for (const round of swiss.rounds) {
    if (round.byeRegistrationId) add(round.byeRegistrationId, points.bye);
    for (const match of round.matches) {
      const red = match.redRegistrationId;
      const blue = match.blueRegistrationId;
      if (!red || !blue || match.status !== 'completed') continue;
      opponents.set(red, [...(opponents.get(red) ?? []), blue]);
      opponents.set(blue, [...(opponents.get(blue) ?? []), red]);
      if (match.winnerRegistrationId === null) {
        add(red, points.draw);
        add(blue, points.draw);
        continue;
      }
      const winner = match.winnerRegistrationId;
      add(winner, points.win);
      add(winner === red ? blue : red, points.loss);
    }
  }

  const buchholz = new Map<string, number>();
  for (const [id, faced] of opponents) {
    buchholz.set(
      id,
      faced.reduce((total, opponentId) => total + (swissPts.get(opponentId) ?? 0), 0),
    );
  }
  return { swissPts, buchholz };
}

/** Read a numeric stat off a standings row (the API sends them loosely typed). */
export const stat = (row: SwissStandingsRow, key: string): number => Number(row.stats[key] ?? 0);
