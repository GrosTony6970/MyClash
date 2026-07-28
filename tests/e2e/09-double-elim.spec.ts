import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import {
  apiFor,
  createBracketTournament,
  ensurePersons,
  grandFinalRound,
  personName,
  playDoubleElim,
  readBracket,
  resetRound,
  type Api,
  type Bracket,
  type Person,
} from './_bracket';

/**
 * Double elimination, end to end against a real database (run with
 * E2E_DOUBLE_ELIM=1).
 *
 * Double elim is the most heavily unit-tested format in the repo — and until this
 * spec, no test had ever generated a `double_elim` phase against real rows.
 * That gap matters here more than for any other format, because advancement is
 * STRING MATCHING: the generator writes `source_a_ref: 'loser of WBR1P3'` and
 * `buildSelfRef` stamps the completed slot `WBR1P3`. Disagree by one character
 * and nothing fills the downstream slot, nothing throws, and the tournament
 * stalls forever. Slice 1 shipped exactly that bug.
 *
 * The in-memory harness (`double-elim-simulation.harness.ts`) catches ref
 * mismatches, but re-implements propagation itself. Only a real playthrough
 * exercises:
 *   - `createInitialBracketMatches` pre-creating a placeholder match per slot but
 *     EXCLUDING the conditional grand-final reset, which must then be created on
 *     demand when the losers-bracket entrant wins (scenario A);
 *   - `grandFinalEndsBracket` short-circuiting on a real `registration_a_id`, so
 *     an unneeded reset is correctly left unplayed (scenario B);
 *   - the config projection feeding `rankingBracketShape`, where an enabled-but-
 *     unplayed reset makes `computeFinalRanking` return an EMPTY ranking for the
 *     whole tournament (checked on the final-ranking page in every scenario);
 *   - advancement being fire-and-forget, so the races are real.
 *
 * Four scenarios, chosen for structural distinctness rather than coverage of the
 * option matrix (the generator unit tests own that). Expected slot/match counts
 * are HARDCODED from `totalDoubleElimMatches` so a drift shows up as a diff
 * rather than being silently recomputed from the value under test.
 */
const DOUBLE_ELIM = ['1', 'true', 'yes'].includes(
  (process.env.E2E_DOUBLE_ELIM ?? '').toLowerCase(),
);

/** Enough fighters for the largest scenario; all four share this roster. */
const ROSTER_SIZE = 16;

interface Scenario {
  /** Slug fragment + test title. */
  key: string;
  fighters: number;
  /** Body for POST /tournaments/:id/generate-bracket. */
  options: Record<string, unknown>;
  /** Force the losers-bracket entrant to win the grand final. */
  forceLbWinsGrandFinal?: boolean;
  expect: {
    totalSlots: number;
    playedMatches: number;
    bracketSize: number;
    wbRounds: number;
    lbRounds: number;
    playInMatchCount: number;
  };
}

test.describe.serial('double elim', () => {
  // Every spec shares the one throwaway event from global-setup, and
  // playwright.e2e.config.ts pins workers:1 — so these run in order.
  test.skip(!DOUBLE_ELIM, 'set E2E_DOUBLE_ELIM=1 to play double-elimination brackets for real');

  /**
   * A. Play-in + grand-final reset, with the reset ACTUALLY PLAYED.
   *
   * The highest-risk path in the feature. 12 fighters trim to a bracket of 8 with
   * a 4-match play-in (double elim can never use byes — a bye has no loser, so
   * every losers-bracket slot fed by one would deadlock; this is the Slice 1
   * regression). Forcing the losers-bracket entrant to win the grand final makes
   * the reset necessary, and the reset is the ONE slot with no placeholder match
   * row: it has to be created on demand mid-tournament.
   */
  const PLAY_IN_RESET: Scenario = {
    key: 'play-in-reset',
    fighters: 12,
    options: { phaseType: 'double_elim', qualifyCount: 12, grandFinalReset: true },
    forceLbWinsGrandFinal: true,
    expect: {
      totalSlots: 19,
      playedMatches: 19,
      bracketSize: 8,
      wbRounds: 3,
      lbRounds: 4,
      playInMatchCount: 4,
    },
  };

  /** B. Reset enabled but the unbeaten entrant wins it — reset correctly skipped. */
  const RESET_SKIPPED: Scenario = {
    key: 'reset-skipped',
    fighters: 8,
    options: { phaseType: 'double_elim', qualifyCount: 8, grandFinalReset: true },
    expect: {
      totalSlots: 15,
      playedMatches: 14,
      bracketSize: 8,
      wbRounds: 3,
      lbRounds: 4,
      playInMatchCount: 0,
    },
  };

  /** C. Bronze mode: no grand final at all, truncated ladder ending on a bronze match. */
  const BRONZE: Scenario = {
    key: 'bronze',
    fighters: 8,
    options: {
      phaseType: 'double_elim',
      qualifyCount: 8,
      secondChanceTarget: 'bronze',
      bronzeMatch: true,
    },
    expect: {
      totalSlots: 12,
      playedMatches: 12,
      bracketSize: 8,
      wbRounds: 3,
      lbRounds: 3,
      playInMatchCount: 0,
    },
  };

  /** D. Repechage cutoff: only the last 8 get a second chance. */
  const REPECHAGE: Scenario = {
    key: 'repechage-last-8',
    fighters: 16,
    options: { phaseType: 'double_elim', qualifyCount: 16, repechageEntrySize: 8 },
    expect: {
      totalSlots: 22,
      playedMatches: 22,
      bracketSize: 16,
      wbRounds: 4,
      lbRounds: 4,
      playInMatchCount: 0,
    },
  };

  test('A. play-in bracket plays the grand-final reset it had no match row for', async ({
    request,
    page,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const built = await build(api, PLAY_IN_RESET);
    const { generated, tournament } = built;

    expect(generated.hasPlayInRound).toBe(true);
    expect(generated.slots.filter((s) => s.round === 0)).toHaveLength(4);

    // The conditional reset is the only slot generated WITHOUT a placeholder
    // match — that exclusion is what makes the on-demand creation below real.
    const reset = resetRound(generated);
    expect(reset).toBe(9); // wbRounds 3 + lbRounds 4 + GF + reset
    const resetBefore = generated.slots.filter((s) => s.round === reset);
    expect(resetBefore).toHaveLength(1);
    expect(resetBefore[0]?.matchId).toBeNull();
    expect(generated.slots.filter((s) => s.round !== reset && s.matchId === null)).toEqual([]);

    const result = await playDoubleElim(api, tournament.id, { forceLbWinsGrandFinal: true });
    expectNoStall(result.stalled.length, result.stallReport);
    expect(result.played).toBe(PLAY_IN_RESET.expect.playedMatches);

    // The reset was created mid-tournament and played to a finish.
    const resetAfter = result.bracket.slots.find((s) => s.round === reset);
    expect(resetAfter?.matchId).not.toBeNull();
    expect(resetAfter?.status).toBe('completed');

    // Seed 1 loses the forced grand final, then wins the reset — which is the
    // whole point of a reset: one loss doesn't beat an unbeaten fighter.
    const gf = result.bracket.slots.find((s) => s.round === grandFinalRound(result.bracket));
    expect(gf?.winnerRegistrationId).toBe(gf?.blueRegistrationId);
    await expectChampionIsTopSeed(page, built, result.championRegistrationId);
  });

  test('B. skips the grand-final reset when the unbeaten entrant wins', async ({
    request,
    page,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const built = await build(api, RESET_SKIPPED);

    const result = await playDoubleElim(api, built.tournament.id);
    expectNoStall(result.stalled.length, result.stallReport);
    expect(result.played).toBe(RESET_SKIPPED.expect.playedMatches);

    // Everything is played EXCEPT the reset, which stays unplayed and matchless.
    const reset = resetRound(result.bracket);
    const resetSlot = result.bracket.slots.find((s) => s.round === reset);
    expect(resetSlot?.status).toBe('scheduled');
    expect(resetSlot?.matchId).toBeNull();
    expect(
      result.bracket.slots.filter((s) => s.round !== reset && s.status !== 'completed'),
    ).toEqual([]);

    // The documented trap: an enabled-but-unplayed reset used to make
    // computeFinalRanking return an empty ranking for the WHOLE tournament. The
    // final-ranking page below is what proves it doesn't.
    await expectChampionIsTopSeed(page, built, result.championRegistrationId);
  });

  test('C. bronze mode ends on a bronze match with no grand final', async ({ request, page }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const built = await build(api, BRONZE);
    const { generated } = built;

    expect(generated.secondChanceTarget).toBe('bronze');
    expect(generated.grandFinalReset).toBe(false);
    expect(grandFinalRound(generated)).toBeNull();
    // Nothing after the truncated losers ladder: the winners final took gold AND
    // silver, and the last losers round IS the bronze match.
    const lastRound = generated.wbRounds! + generated.lbRounds!;
    expect(Math.max(...generated.slots.map((s) => s.round))).toBe(lastRound);
    expect(generated.slots.filter((s) => s.round === lastRound)).toHaveLength(1);

    const result = await playDoubleElim(api, built.tournament.id);
    expectNoStall(result.stalled.length, result.stallReport);
    expect(result.played).toBe(BRONZE.expect.playedMatches);
    expect(result.bracket.slots.filter((s) => s.status !== 'completed')).toEqual([]);

    await expectChampionIsTopSeed(page, built, result.championRegistrationId);
  });

  test('D. repechage cutoff eliminates pre-cutoff losers on a single loss', async ({
    request,
    page,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const built = await build(api, REPECHAGE);
    const { generated } = built;

    expect(generated.repechageEntrySize).toBe(8);
    // The losers bracket opens at the winners round where exactly 8 remain.
    expect(generated.repechageEntryRound).toBe(2);

    const result = await playDoubleElim(api, built.tournament.id);
    expectNoStall(result.stalled.length, result.stallReport);
    expect(result.played).toBe(REPECHAGE.expect.playedMatches);

    // The cutoff's entire purpose: losing winners-round 1 is elimination, so
    // none of those 8 fighters may appear anywhere in the losers bracket.
    const wb = generated.wbRounds!;
    const round1Losers = new Set(
      result.bracket.slots
        .filter((s) => s.round === 1)
        .map((s) =>
          s.winnerRegistrationId === s.redRegistrationId
            ? s.blueRegistrationId
            : s.redRegistrationId,
        )
        .filter((id): id is string => id !== null),
    );
    expect(round1Losers.size).toBe(8);

    const lbEntrants = new Set(
      result.bracket.slots
        .filter((s) => s.round > wb && s.round <= wb + generated.lbRounds!)
        .flatMap((s) => [s.redRegistrationId, s.blueRegistrationId])
        .filter((id): id is string => id !== null),
    );
    // A repechage with cutoff K is the losers bracket of a K-sized double elim,
    // so exactly K-1 fighters ever enter it.
    expect(lbEntrants.size).toBe(7);
    expect([...lbEntrants].filter((id) => round1Losers.has(id))).toEqual([]);

    await expectChampionIsTopSeed(page, built, result.championRegistrationId);
  });
});

// ── Shared steps ─────────────────────────────────────────────────────────────

interface Built {
  scenario: Scenario;
  tournament: Awaited<ReturnType<typeof createBracketTournament>>;
  /** The bracket right after generate + populate, before any match is played. */
  generated: Bracket;
  roster: Person[];
}

/**
 * Roster → tournament → registrations → bracket → seeded round 1 (and round 0).
 *
 * No pools anywhere: with no pool phase, `populateBracket` falls back to seeding
 * straight from the registration seeds set in `createBracketTournament`, which is
 * what makes the draw and the expected champion deterministic.
 */
async function build(api: Api, scenario: Scenario): Promise<Built> {
  const { eventId } = runContext();
  const token = Date.now().toString(36);

  const roster = await ensurePersons(api, eventId, ROSTER_SIZE);
  const tournament = await createBracketTournament(api, eventId, {
    name: `DE ${scenario.key}`,
    slug: `de-${scenario.key}-${token}`,
    fighters: roster.slice(0, scenario.fighters),
  });

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-bracket`, { data: scenario.options }),
  );
  await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

  const generated = await readBracket(api, tournament.id);
  expect(generated.phaseType).toBe('double_elim');
  expect(generated.totalSlots).toBe(scenario.expect.totalSlots);
  expect(generated.slots).toHaveLength(scenario.expect.totalSlots);
  expect(generated.bracketSize).toBe(scenario.expect.bracketSize);
  expect(generated.wbRounds).toBe(scenario.expect.wbRounds);
  expect(generated.lbRounds).toBe(scenario.expect.lbRounds);
  expect(generated.playInMatchCount).toBe(scenario.expect.playInMatchCount);

  // Every fighter must be on the board before a single match is played,
  // otherwise "nothing stalled" would be vacuously true.
  const seeded = new Set(
    generated.slots
      .filter((s) => s.round <= 1)
      .flatMap((s) => [s.redRegistrationId, s.blueRegistrationId])
      .filter((id): id is string => id !== null),
  );
  expect(seeded.size).toBe(scenario.fighters);

  console.log(
    `  → ${scenario.key}: ${scenario.fighters} fighters, bracket of ${generated.bracketSize}, ` +
      `${generated.totalSlots} slots (WB ${generated.wbRounds} / LB ${generated.lbRounds})`,
  );
  return { scenario, tournament, generated, roster };
}

/** Fail with the ref strings that never resolved, not just a count. */
function expectNoStall(stalledCount: number, report: string): void {
  expect(stalledCount, report).toBe(0);
}

/**
 * The lower seed always wins, so seed 1 takes every scenario — including A, where
 * seed 1 loses the forced grand final and wins the reset.
 *
 * Verified on the admin final-ranking page rather than over the API: there is no
 * final-ranking endpoint (`TournamentPlacementService` is service-internal), and
 * that page runs the same `computeFinalRanking` + `rankingBracketShape` every
 * product surface uses. Asserting on it here is what closes the empty-ranking
 * trap on real data. Fighter names are ASCII and created by this spec, so the
 * assertion stays locale-proof (the page's own labels are bilingual).
 */
async function expectChampionIsTopSeed(
  page: Page,
  built: Built,
  championRegistrationId: string | null,
): Promise<void> {
  const { orgSlug, eventId } = runContext();
  const champion = built.tournament.personByRegistrationId.get(championRegistrationId ?? '');
  expect(champion, 'no champion was decided').toBeDefined();
  expect(personName(champion!)).toBe(personName(built.roster[0]!));

  await page.goto(
    `/org/${orgSlug}/events/${eventId}/finalranking?tournamentId=${built.tournament.id}`,
  );
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(built.scenario.fighters);
  await expect(rows.first()).toContainText(personName(champion!));
}
