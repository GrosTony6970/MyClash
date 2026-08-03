import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import {
  apiFor,
  createBracketTournament,
  ensurePersons,
  POINT_CAP,
  readBracket,
  scoreMatch,
  seedMap,
  type Api,
} from './_bracket';
import {
  expectedBuchholz,
  playSwiss,
  readSwiss,
  readSwissAdmin,
  readSwissStandings,
  seedByRegistration,
  stat,
  swissViolations,
  type SwissMatch,
  type SwissRound,
  type SwissRounds,
} from './_swiss';

/**
 * Swiss system, end to end against a real database (run with E2E_SWISS=1).
 *
 * Swiss earns an integration test for a reason no other format has: ROUND N+1
 * DOES NOT EXIST until round N is scored. `SwissAdvanceService.onMatchCompleted`
 * pairs it, invoked from `MatchCompletionService` and wrapped in a catch that
 * swallows — because a completion side effect must never fail the exchange that
 * triggered it. So a broken advance edge throws nothing, logs a warning nobody
 * is watching, and the tournament simply stops after round 1. That is the
 * double-elim `source_a_ref` failure mode again: silent, permanent, invisible to
 * every unit test.
 *
 * Three things only real rows can prove:
 *
 *   1. **Auto-advance fires from the PAD.** Bouts here are played with clean
 *      exchanges until the ruleset engine trips `first_to_points` — the path
 *      web-scoring actually drives. An earlier bracket spec declared winners with
 *      `PATCH /matches/:id/status`, and for a while that endpoint was the only
 *      one wired to advancement at all: a bracket scored on the pad advanced
 *      nowhere, and testing through the endpoint hid it.
 *   2. **The DI graph resolves at boot.** `SwissCoreModule` is a leaf precisely
 *      so `PhasesModule` can import it for auto-advance without closing a cycle.
 *      A NestJS module cycle is invisible to `tsc` AND to vitest (esbuild emits
 *      no decorator metadata) — it surfaces only when the API boots. Calling
 *      these endpoints against a deployed API is the check.
 *   3. **The standings arithmetic over real scored matches.** Buchholz is
 *      recomputed here from the rounds, independently, because it is the one
 *      column that cannot be right by accident: it only agrees if the opponent
 *      lists AND the points are both right.
 *
 * The round-1 draw is random (decision 1's default), so who plays whom differs
 * per run. Determinism comes from the winner RULE instead — the lower seed
 * always wins — which makes `Seed 01` unbeaten in every run whoever they were
 * drawn against, and makes every assertion below an invariant rather than a
 * hardcoded table.
 */
const SWISS = ['1', 'true', 'yes'].includes((process.env.E2E_SWISS ?? '').toLowerCase());

/**
 * Odd on purpose: 13 exercises the bye in every round without making the run
 * long. `recommendedRoundCount(13)` is 4, which is what the phase is pinned to
 * — 4 rounds x 6 bouts = 24 matches, ~5 exchange POSTs each.
 */
const FIELD = 13;
const ROUNDS = 4;
/** The defaults `SWISS_DEFAULTS.points` writes when the body omits them. */
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0, bye: 3 };

test.describe(SWISS ? 'Swiss system' : 'Swiss system (set E2E_SWISS=1 to run)', () => {
  test.skip(!SWISS, 'Writes real tournaments and scores real matches; opt in with E2E_SWISS=1.');

  /**
   * A tournament with `count` fighters and a freshly generated Swiss phase.
   *
   * `runContext()` is read HERE, not in the describe body: the body runs at
   * collection time even when every test in it is skipped, and it reads a file
   * global-setup writes. At describe level a fresh checkout would fail to
   * collect the whole suite over a spec that was never going to run.
   */
  async function build(api: Api, key: string, count: number, roundCount: number) {
    const { eventId } = runContext();
    const roster = await ensurePersons(api, eventId, count);
    // Reused from the bracket helper: it creates a tournament with NO pools,
    // pins the point cap so the ENGINE's completion is what ends a bout, and
    // registers everyone seeded 1..N. All three are what Swiss wants too.
    const tournament = await createBracketTournament(api, eventId, {
      name: `Swiss ${key}`,
      slug: `swiss-${key}-${Date.now().toString(36)}`,
      fighters: roster.slice(0, count),
    });

    const generated = await api.json<{
      phaseId: string;
      entrants: number;
      roundCount: number;
      firstRound: { roundId: string; roundNumber: number } | null;
    }>(
      await api.post(`tournaments/${tournament.id}/generate-swiss`, {
        data: { roundCount, seedingStrategy: 'random' },
      }),
    );

    return { tournament, generated, seeds: seedByRegistration(tournament.personByRegistrationId) };
  }

  test('A. an odd field pairs itself round by round, off the pad', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { tournament, generated, seeds } = await build(api, 'odd', FIELD, ROUNDS);

    // Generation pairs round 1 and nothing else — the rest is the engine's job.
    expect(generated.entrants).toBe(FIELD);
    expect(generated.roundCount).toBe(ROUNDS);
    expect(generated.firstRound?.roundNumber).toBe(1);

    const opening = await readSwiss(api, tournament.id);
    expect(opening.rounds).toHaveLength(1);
    expect(opening.rounds[0]?.matches).toHaveLength(Math.floor(FIELD / 2));
    expect(
      opening.rounds[0]?.byeRegistrationId,
      'an odd field owes exactly one bye',
    ).not.toBeNull();
    // The projection has to carry NAMES: it returned registration ids only until
    // slice 8, which no surface can render.
    expect(opening.rounds[0]?.matches[0]?.redFighterName).toBeTruthy();
    expect(opening.rounds[0]?.byeFighterName).toBeTruthy();

    const result = await playSwiss(api, tournament.id, seeds);
    expect(result.stallReport, result.stallReport).toBe('');
    expect(result.roundsPlayed).toBe(ROUNDS);
    expect(result.played).toBe(ROUNDS * Math.floor(FIELD / 2));

    const swiss = result.swiss;
    expect(swiss.rounds).toHaveLength(ROUNDS);
    expect(swiss.roundsCompleted).toBe(ROUNDS);

    // Structural invariants, reported together: a pairing bug usually breaks the
    // same rule in several rounds, and one assertion per run makes that take
    // four runs to see.
    const violations = swissViolations(swiss, FIELD);
    expect(violations, violations.map((v) => `round ${v.round}: ${v.detail}`).join('\n')).toEqual(
      [],
    );

    expectEngineDecided(swiss);

    // The bout labels the exchange round codes (`LSW-S3-M2`) are built from.
    for (const round of swiss.rounds) {
      for (const [index, match] of round.matches.entries()) {
        expect(match.matchNumberLabel).toBe(`SW-R${round.roundNumber}-M${index + 1}`);
      }
    }

    // The organiser view agrees the rounds are legal. `validateSwissRound` is
    // what blocks the next round when set-sides breaks one, so a false "valid"
    // here would let a broken round pair another on top of it.
    const admin = await readSwissAdmin(api, tournament.id);
    expect(admin.rounds.filter((round) => !round.validity.valid)).toEqual([]);
    expect(admin.recommendedRoundCount).toBe(ROUNDS);
  });

  test('B. standings reproduce points and Buchholz computed independently', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { tournament, seeds } = await build(api, 'standings', FIELD, ROUNDS);

    const result = await playSwiss(api, tournament.id, seeds);
    expect(result.stallReport, result.stallReport).toBe('');

    const standings = await readSwissStandings(api, tournament.id);
    expect(standings.rows).toHaveLength(FIELD);
    expect(standings.roundsCompleted).toBe(ROUNDS);
    expect(standings.rows.filter((row) => row.withdrawn)).toEqual([]);

    const { swissPts, buchholz } = expectedBuchholz(result.swiss, DEFAULT_POINTS);
    for (const row of standings.rows) {
      expect(stat(row, 'swissPts'), `${row.displayName} points`).toBe(
        swissPts.get(row.registrationId) ?? 0,
      );
      expect(stat(row, 'buchholz'), `${row.displayName} Buchholz`).toBe(
        buchholz.get(row.registrationId) ?? 0,
      );
    }

    // Ranks are dense 1..N, and the primary key descends.
    expect(standings.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: FIELD }, (_, i) => i + 1),
    );
    const points = standings.rows.map((row) => stat(row, 'swissPts'));
    expect([...points].sort((a, b) => b - a)).toEqual(points);

    // Seed 1 wins every bout and a bye is worth a win, so they hold the maximum
    // possible score. Asserted as "holds the max", NOT "is rank 1": with a random
    // draw another fighter can legitimately go unbeaten too, and failing on that
    // would make this spec flaky for a correct outcome.
    const seedOne = standings.rows.find((row) => seeds.get(row.registrationId) === 1);
    expect(seedOne, 'seed 1 is missing from the standings').toBeTruthy();
    expect(stat(seedOne!, 'swissPts')).toBe(ROUNDS * DEFAULT_POINTS.win);
    expect(stat(standings.rows[0]!, 'swissPts')).toBe(ROUNDS * DEFAULT_POINTS.win);

    // Every key the chain ranks on must be a column in the payload. Ranking on a
    // value the reader cannot see is exactly what the standings service refuses
    // to do, and this is the assertion that keeps it honest.
    for (const key of standings.tiebreakChain) {
      if (key === 'rulesetChain') continue;
      expect(
        standings.columns.some((column) => column.key === key),
        `tiebreak "${key}" ranks on a column that is not in the table`,
      ).toBe(true);
    }
  });

  test('C. a swap preserves the round, and a rematch has to be confirmed', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { tournament, seeds } = await build(api, 'override', FIELD, ROUNDS);

    const before = await readSwiss(api, tournament.id);
    const roundOne = before.rounds[0]!;
    // Across two DIFFERENT bouts, so this is a real exchange of fighters rather
    // than a sides flip inside one match.
    const a = roundOne.matches[0]!.redRegistrationId!;
    const b = roundOne.matches[1]!.blueRegistrationId!;

    await api.ok(
      await api.post(`swiss-rounds/${roundOne.id}/swap`, {
        data: { aRegistrationId: a, bRegistrationId: b },
      }),
    );

    const swapped = (await readSwiss(api, tournament.id)).rounds[0]!;
    expect(swapped.manuallyAdjusted, 'a hand-edited round must badge itself PUBLICLY').toBe(true);
    expect(positionOf(swapped).get(a)).not.toBe(positionOf(roundOne).get(a));
    // The invariant a swap preserves BY CONSTRUCTION: everyone still appears
    // exactly once, and there is still exactly one bye.
    expect(swissViolations({ ...before, rounds: [swapped] }, FIELD)).toEqual([]);
    expect((await readSwissAdmin(api, tournament.id)).rounds[0]?.validity.valid).toBe(true);

    // Giving the bye to someone else is the SAME operation — which is why the
    // bye is modelled as a swappable position rather than a special case.
    const byeHolder = swapped.byeRegistrationId!;
    const other = swapped.matches[2]!.redRegistrationId!;
    await api.ok(
      await api.post(`swiss-rounds/${roundOne.id}/swap`, {
        data: { aRegistrationId: byeHolder, bRegistrationId: other },
      }),
    );
    const rebyed = (await readSwiss(api, tournament.id)).rounds[0]!;
    expect(rebyed.byeRegistrationId).toBe(other);
    expect(swissViolations({ ...before, rounds: [rebyed] }, FIELD)).toEqual([]);

    // ── warn, then confirm ───────────────────────────────────────────────────
    // Play round 1, then deliberately reconstruct a pairing the engine had just
    // avoided. The engine never produces a rematch while a legal alternative
    // exists, so asking for one is the only way to reach this branch.
    const bout = rebyed.matches[0]!;
    const fighter = bout.redRegistrationId!;
    const oldOpponent = bout.blueRegistrationId!;
    for (const match of rebyed.matches) {
      await scoreMatch(api, match.id, winnerSideOf(match, seeds), POINT_CAP);
    }
    const roundTwo = await waitForRound(api, tournament.id, 2);
    expect(roundTwo, 'round 2 never paired itself after round 1 completed').toBeTruthy();

    const rematch = plannedRematch(roundTwo!, fighter, oldOpponent);
    // Skipped rather than faked when the draw put one of them on the bye: there
    // is no swap that creates a rematch in that case, and inventing one would
    // assert something the product does not do.
    test.skip(rematch === null, 'the round-2 draw left no swap that creates a rematch');

    const refused = await api.post(`swiss-rounds/${roundTwo!.id}/swap`, {
      data: { aRegistrationId: rematch!.a, bRegistrationId: rematch!.b },
    });
    expect(refused.status(), 'a rematch-creating swap must warn before it happens').toBe(409);
    const body = (await refused.json()) as {
      warnings?: Array<{ code: string; registrationIds: string[] }>;
    };
    expect(body.warnings?.some((warning) => warning.code === 'creates-rematch')).toBe(true);

    // The same request, confirmed: the organiser may well want it.
    await api.ok(
      await api.post(`swiss-rounds/${roundTwo!.id}/swap`, {
        data: { aRegistrationId: rematch!.a, bRegistrationId: rematch!.b, confirm: true },
      }),
    );
    const confirmed = (await readSwiss(api, tournament.id)).rounds[1]!;
    expect(confirmed.manuallyAdjusted).toBe(true);
    // Still a legal round: a confirmed warning is not a broken invariant.
    expect(swissViolations({ ...before, rounds: [confirmed] }, FIELD)).toEqual([]);
  });

  test('D. a withdrawal leaves its played results standing', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { tournament, seeds } = await build(api, 'withdraw', FIELD, ROUNDS);

    const opening = await readSwiss(api, tournament.id);
    const roundOne = opening.rounds[0]!;
    for (const match of roundOne.matches) {
      await scoreMatch(api, match.id, winnerSideOf(match, seeds), POINT_CAP);
    }
    expect(await waitForRound(api, tournament.id, 2)).toBeTruthy();

    // The LOSER leaves, so the surviving result is a win their opponent keeps.
    const bout = roundOne.matches[0]!;
    const winnerSide = winnerSideOf(bout, seeds);
    const leaver = winnerSide === 'red' ? bout.blueRegistrationId! : bout.redRegistrationId!;
    const opponent = winnerSide === 'red' ? bout.redRegistrationId! : bout.blueRegistrationId!;

    await api.ok(
      await api.post(`swiss-phases/${opening.phaseId}/withdraw`, {
        data: { registrationId: leaver },
      }),
    );

    const standings = await readSwissStandings(api, tournament.id);
    const leaverRow = standings.rows.find((row) => row.registrationId === leaver);
    expect(
      leaverRow,
      'a withdrawal keeps its row — deleting it would rewrite every opponent record',
    ).toBeTruthy();
    expect(leaverRow!.withdrawn).toBe(true);
    // They are out from the round AFTER the ones already drawn — round 2 was
    // paired by the auto-advance before the withdrawal, and a fighter already
    // dealt into a round stays in it. Re-drawing a live round behind the
    // organiser's back would be worse than one extra walkover.
    const outFrom = leaverRow!.withdrawnAtRound!;
    expect(outFrom).toBe(3);

    // Decision 11: the bout was fought, so their opponent keeps the win AND the
    // Buchholz contribution. The second half is what a naive "remove the
    // fighter" implementation silently gets wrong.
    const opponentRow = standings.rows.find((row) => row.registrationId === opponent)!;
    expect(stat(opponentRow, 'swissPts')).toBeGreaterThanOrEqual(DEFAULT_POINTS.win);
    const { buchholz } = expectedBuchholz(await readSwiss(api, tournament.id), DEFAULT_POINTS);
    expect(stat(opponentRow, 'buchholz')).toBe(buchholz.get(opponent) ?? 0);

    // Every round drawn AFTER the withdrawal is dealt without them.
    const rest = await playSwiss(api, tournament.id, seeds);
    expect(rest.stallReport, rest.stallReport).toBe('');
    const later = rest.swiss.rounds.filter((round) => round.roundNumber >= outFrom);
    expect(
      later.length,
      'no round was drawn after the withdrawal — nothing was proved',
    ).toBeGreaterThan(0);
    for (const round of later) {
      const dealt = round.matches.flatMap((m) => [m.redRegistrationId, m.blueRegistrationId]);
      expect(dealt, `round ${round.roundNumber} dealt a withdrawn fighter`).not.toContain(leaver);
      expect(round.byeRegistrationId).not.toBe(leaver);
    }
    // The field is even from here (13 - 1), so the bye stops.
    for (const round of later) {
      expect(
        round.byeRegistrationId,
        `round ${round.roundNumber} gave a bye to an even field`,
      ).toBeNull();
      expect(round.matches).toHaveLength((FIELD - 1) / 2);
    }
  });

  test('E. finalise freezes the standings and seeds a bracket by Swiss rank', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { tournament, seeds } = await build(api, 'cut', FIELD, ROUNDS);

    const result = await playSwiss(api, tournament.id, seeds);
    expect(result.stallReport, result.stallReport).toBe('');
    const phaseId = result.swiss.phaseId!;

    await api.ok(await api.post(`swiss-phases/${phaseId}/finalise`, { data: {} }));
    const finalised = await readSwiss(api, tournament.id);
    expect(finalised.finalized?.atRound).toBe(ROUNDS);

    const standings = await readSwissStandings(api, tournament.id);
    const cut = standings.rows.slice(0, 8).map((row) => row.registrationId);

    // No `sourcePhaseId` on the body: `GenerateBracketDto` is `.strict()` and has
    // no such field, so sending one 400s. `rankFromSwiss` finds the Swiss phase
    // from the tournament itself — which is why a three-stage tournament
    // (pools → Swiss → bracket) does not have to say which phase to read.
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-bracket`, {
        data: { phaseType: 'single_elim', qualifyCount: 8, seedingStrategy: 'by-swiss-rank' },
      }),
    );
    await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

    // Swiss standings are ALREADY one ranked list, so unlike `by-pool-rank` there
    // is no snake flattening: rank K maps straight onto seed K. The WHOLE cut is
    // asserted, not just rank 1 — an off-by-one in the handoff would still put
    // the right person on seed 1.
    const bracketSeeds = seedMap(await readBracket(api, tournament.id));
    for (const [index, registrationId] of cut.entries()) {
      expect(
        bracketSeeds.get(registrationId),
        `Swiss rank ${index + 1} did not land on bracket seed ${index + 1}`,
      ).toBe(index + 1);
    }
  });
});

// ── Local helpers ────────────────────────────────────────────────────────────

/** Which side the lower seed is on — the deterministic winner rule. */
function winnerSideOf(match: SwissMatch, seeds: Map<string, number>): 'red' | 'blue' {
  const red = seeds.get(match.redRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  const blue = seeds.get(match.blueRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return red <= blue ? 'red' : 'blue';
}

/**
 * A swap that would put `fighter` back in front of `oldOpponent`, or null when
 * this round's draw makes that impossible (either of them on the bye).
 *
 * Swapping `oldOpponent` with whoever `fighter` is currently drawn against is
 * the minimal way to force the rematch warning.
 */
function plannedRematch(
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

/**
 * Poll until `roundNumber` has paired ITSELF, or give up.
 *
 * Advancement is fire-and-forget, so the round appears some time after the final
 * exchange POST returns — a bare re-read races it.
 */
async function waitForRound(
  api: Api,
  tournamentId: string,
  roundNumber: number,
  tries = 20,
  delayMs = 750,
): Promise<SwissRound | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const swiss = await readSwiss(api, tournamentId);
    const round = swiss.rounds.find((r) => r.roundNumber === roundNumber);
    if (round) return round;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/** registrationId → the bout id they are in, or 'bye'. */
function positionOf(round: SwissRound): Map<string, string> {
  const positions = new Map<string, string>();
  for (const match of round.matches) {
    if (match.redRegistrationId) positions.set(match.redRegistrationId, match.id);
    if (match.blueRegistrationId) positions.set(match.blueRegistrationId, match.id);
  }
  if (round.byeRegistrationId) positions.set(round.byeRegistrationId, 'bye');
  return positions;
}

/**
 * Every completed bout ended on the point cap, with a winner.
 *
 * This is what separates "the test decided" from "the ENGINE decided": the
 * driver only ever posts exchanges, so a winner sitting exactly on the cap means
 * `first_to_points` fired. A bout completed with a NULL winner (both sides at the
 * cap) can never close its round, so the phase would stall — and this catches it
 * at the bout rather than four rounds later as a missing-round timeout.
 */
function expectEngineDecided(swiss: SwissRounds): void {
  for (const round of swiss.rounds) {
    for (const match of round.matches) {
      expect(match.status, `${match.matchNumberLabel} did not complete`).toBe('completed');
      expect(
        match.winnerRegistrationId,
        `${match.matchNumberLabel} completed with no winner`,
      ).not.toBeNull();
      const winnerScore =
        match.winnerRegistrationId === match.redRegistrationId ? match.redScore : match.blueScore;
      expect(winnerScore, `${match.matchNumberLabel} winner did not reach the cap`).toBe(POINT_CAP);
    }
  }
}
