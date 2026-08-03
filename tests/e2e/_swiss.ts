import { sleep, type Api } from './_api';
import {
  createBracketTournament,
  ensurePersons,
  POINT_CAP,
  scoreMatch,
  type BracketTournament,
  type Person,
} from './_bracket';

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
      await scoreMatch(api, match.id, winnerSideOf(match, seeds), pointCap);
    }
    if (round.roundNumber >= swiss.roundCount) {
      return {
        played,
        roundsPlayed: round.roundNumber,
        swiss: await readSwiss(api, tournamentId),
        stallReport: '',
      };
    }

    const next = await waitForRound(
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

/**
 * Which side the lower seed is on — the deterministic winner rule.
 *
 * Exported because the specs score rounds by hand too (to set up an override or
 * a withdrawal mid-phase), and a second copy of this rule is a second chance for
 * the two to disagree about who was supposed to win.
 */
export function winnerSideOf(match: SwissMatch, seeds: Map<string, number>): 'red' | 'blue' {
  const red = seeds.get(match.redRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  const blue = seeds.get(match.blueRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return red <= blue ? 'red' : 'blue';
}

/**
 * Poll until `roundNumber` has been paired by the auto-advance, or give up.
 *
 * A poll, not a sleep: advancement is fire-and-forget, so the round appears some
 * time AFTER the final exchange POST returns and a bare re-read races it.
 * Exported for the specs that hand over mid-phase.
 */
export async function waitForRound(
  api: Api,
  tournamentId: string,
  roundNumber: number,
  tries = 20,
  delayMs = 750,
): Promise<SwissRounds | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const swiss = await readSwiss(api, tournamentId);
    if (swiss.rounds.some((round) => round.roundNumber === roundNumber)) return swiss;
    await sleep(delayMs);
  }
  return null;
}

/** Read a numeric stat off a standings row (the API sends them loosely typed). */
export const stat = (row: SwissStandingsRow, key: string): number => Number(row.stats[key] ?? 0);

/**
 * A swap that would put `fighter` back in front of `oldOpponent`, or null when
 * this round's draw makes that impossible (either of them on the bye).
 *
 * Swapping `oldOpponent` with whoever `fighter` is currently drawn against is
 * the minimal way to force the rematch warning.
 */
export function plannedRematch(
  round: SwissRound,
  fighter: string,
  oldOpponent: string,
): { a: string; b: string } | null {
  if (round.byeRegistrationId === fighter || round.byeRegistrationId === oldOpponent) return null;
  const bout = round.matches.find(
    (match) => match.redRegistrationId === fighter || match.blueRegistrationId === fighter,
  );
  if (!bout) return null;
  const current =
    bout.redRegistrationId === fighter ? bout.blueRegistrationId! : bout.redRegistrationId!;
  // Already facing them — the engine would have had to force it, and there is
  // nothing left for a swap to create.
  if (current === oldOpponent) return null;
  return { a: current, b: oldOpponent };
}

/** registrationId → the bout id they are in, or 'bye'. */
/** The round itself once it has paired, rather than the whole phase. */
export async function waitForRoundOnly(
  api: Api,
  tournamentId: string,
  roundNumber: number,
): Promise<SwissRound | null> {
  const swiss = await waitForRound(api, tournamentId, roundNumber);
  return swiss?.rounds.find((round) => round.roundNumber === roundNumber) ?? null;
}

export function positionOf(round: SwissRound): Map<string, string> {
  const positions = new Map<string, string>();
  for (const match of round.matches) {
    if (match.redRegistrationId) positions.set(match.redRegistrationId, match.id);
    if (match.blueRegistrationId) positions.set(match.blueRegistrationId, match.id);
  }
  if (round.byeRegistrationId) positions.set(round.byeRegistrationId, 'bye');
  return positions;
}

/**
 * A tournament with `count` fighters and a freshly generated Swiss phase.
 *
 * Built on `createBracketTournament` deliberately: it creates a tournament with
 * NO pools, pins the point cap so the ENGINE's completion is what ends a bout,
 * and registers everyone seeded 1..N. All three are what a Swiss spec wants too,
 * and a second copy would be a second thing to keep in step.
 */
export async function buildSwissTournament(
  api: Api,
  eventId: string,
  opts: { key: string; count: number; roundCount: number },
): Promise<{
  tournament: BracketTournament;
  generated: GeneratedSwiss;
  seeds: Map<string, number>;
}> {
  const roster = await ensurePersons(api, eventId, opts.count);
  const tournament = await createBracketTournament(api, eventId, {
    name: `Swiss ${opts.key}`,
    slug: `swiss-${opts.key}-${Date.now().toString(36)}`,
    fighters: roster.slice(0, opts.count),
  });

  const generated = await api.json<GeneratedSwiss>(
    await api.post(`tournaments/${tournament.id}/generate-swiss`, {
      data: { roundCount: opts.roundCount, seedingStrategy: 'random' },
    }),
  );

  return { tournament, generated, seeds: seedByRegistration(tournament.personByRegistrationId) };
}

/** The body of `POST /tournaments/:id/generate-swiss`. */
export interface GeneratedSwiss {
  phaseId: string;
  entrants: number;
  roundCount: number;
  firstRound: { roundId: string; roundNumber: number } | null;
}
