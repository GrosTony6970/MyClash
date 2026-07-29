import { test, expect, request as apiRequest } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureClub, ensureRoster, personName, type Person } from './_bracket';
import { playTournamentToChampion, type FinishedTournament } from './_tournament';

/**
 * League standings, end to end against a real database (run with E2E_LEAGUE=1).
 *
 * This is the only path in the repo that drives `TournamentPlacementService` +
 * the shared `computeFinalRanking` against real rows. Both are unit-tested over
 * hand-built slot arrays; neither had ever been asked "given a tournament that
 * was actually played, who finished where" — and league points, medals, club
 * standings and the season report are all derived from that one answer.
 *
 * The assertion that makes the rest meaningful: **the lower seed wins every
 * single match** (`playDoubleElim`), and the fighters are named in seed order,
 * so the final placement of an 8-fighter bronze-mode double elim is knowable
 * exactly — seeds 1..8, in order, with no ties. The league table must reproduce
 * it. Nothing here reads a rank back and compares it to itself.
 *
 * Deliberately NOT the FFAMHE points table: the league is created with its own
 * `customPointsByRank`, so a wrong rank lookup shows up as 100 vs 50 rather than
 * 16 vs 13, and the spec never has to track what the shared registry says today.
 *
 * Two tournaments, not one. The second exists for the freeze contract — a
 * finalized season must not move when a late event ticks over — which cannot be
 * proved with nothing new to count. It also covers multi-tournament aggregation
 * (participation counts, summed points), which nothing else does.
 *
 * Runs against the shared throwaway event and, when `E2E_CLEANUP` is set, deletes
 * the leagues it created (they outlive the event otherwise: a league is not
 * owned by an event). The league is returned to `draft` before the run ends, so
 * nothing this spec creates is ever left publicly visible.
 */
const LEAGUE = ['1', 'true', 'yes'].includes((process.env.E2E_LEAGUE ?? '').toLowerCase());
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

/** 8 fighters — the shape `playTournamentToChampion` builds. */
const ROSTER_SIZE = 8;

/** Given name of every fighter this spec creates; the family name is the seed. */
const GIVEN_NAME = 'League';

/**
 * Two real clubs plus an unaffiliated tail, so club standings has all three of
 * its cases: a multi-member club, a smaller one, and the bucket for fighters
 * with no club at all. Names are stable so a rerun reuses the same club rows
 * rather than growing the catalog.
 */
const CLUB_ALPHA = 'E2E Alpha Fencing Club';
const CLUB_BRAVO = 'E2E Bravo Fencing Club';

/** Club of seed N (index N-1), or null for an unaffiliated fighter. */
const CLUB_BY_SEED: ReadonlyArray<string | null> = [
  CLUB_ALPHA,
  CLUB_ALPHA,
  CLUB_ALPHA,
  CLUB_BRAVO,
  CLUB_BRAVO,
  null,
  null,
  null,
];

/**
 * The league's own points table. Round, well-separated values: a placement read
 * one row off is a visible 100-vs-50 diff, not an easily-misread 16-vs-13.
 */
const POINTS_BY_RANK: Readonly<Record<number, number>> = {
  1: 100,
  2: 50,
  3: 30,
  4: 20,
  5: 12,
  6: 9,
  7: 6,
  8: 3,
};

/** Points of every fighter after ONE tournament, in finishing order. */
const POINTS_IN_ORDER = Array.from({ length: ROSTER_SIZE }, (_, i) => POINTS_BY_RANK[i + 1]!);

/** League group every tournament is linked to. */
const GROUP_NAME = 'Open';

/**
 * The ranking group key `weapon_category` produces: the tournament's weapon and
 * the league group it was linked to, both slugified. Hardcoded so a change in
 * either half shows up as a diff instead of being recomputed from the code
 * under test.
 */
const GROUP_KEY = 'longsword::open';

const SEASON_YEAR = 2099;

/** The season report's header, byte for byte (`leagues.service.finalReportCsv`). */
const CSV_HEADER =
  'ranking_group,league_rank,fighter,total_points,participation_count,medal_count,double_hit_average';

// ── API shapes ───────────────────────────────────────────────────────────────

interface LeagueRow {
  id: string;
  slug: string;
  name: string;
  season_year: number;
  status: string;
  public_visibility: boolean;
  finalized_at: string | null;
  scoring_config: unknown;
}

interface StandingsRow {
  ranking_group_key: string;
  fighter_id: string;
  rank: number;
  total_points: number;
  participation_count: number;
  medal_count: number;
  double_hit_average: string;
  per_tournament: Array<{ tournamentId: string; finalRank: number; leaguePoints: number }>;
  global_persons: { display_name: string } | null;
}

interface StandingsPayload {
  league: LeagueRow;
  rows: StandingsRow[];
  pendingTournaments: Array<{ tournamentId: string; name: string }>;
}

interface ClubStandingsPayload {
  clubs: Array<{
    clubId: string;
    name: string;
    totalPoints: number;
    memberCount: number;
    medalCount: number;
    topMembers: Array<{ fighterId: string; name: string; points: number }>;
  }>;
  unaffiliated: { totalPoints: number; memberCount: number; medalCount: number } | null;
}

interface GroupRow {
  id: string;
  name: string;
}

// ── Shared state ─────────────────────────────────────────────────────────────

/**
 * Built by the first test and read by the second. The suite runs one worker and
 * this block is serial, so a failure skips what follows rather than reading a
 * half-built league; a retry re-runs from the first test and rebuilds it all.
 */
interface Fixture {
  eventId: string;
  fighters: Person[];
  league: LeagueRow;
  groupId: string;
  firstTournament: FinishedTournament;
}
let fixture: Fixture;

/** Every league this spec created, for teardown. */
const createdLeagueIds: string[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * `League 01 … League 08`, seeded 1..N, with the club affiliations club
 * standings needs — deliberately a separate roster from the shared `Seed NN`
 * one, which is club-less and shared with specs that would otherwise dictate
 * our clubs.
 *
 * The names sort in seed order on purpose: `computeFinalRanking` separates
 * fighters eliminated in the same round by pool score then NAME, and with no
 * pools that tiebreak is the whole ordering. Name order == seed order is what
 * makes the expected final ranking exactly 1..8.
 */
async function leagueRoster(api: Api, eventId: string): Promise<Person[]> {
  const clubIds = new Map<string, string>();
  for (const name of [CLUB_ALPHA, CLUB_BRAVO]) clubIds.set(name, await ensureClub(api, name));

  return ensureRoster(
    api,
    eventId,
    CLUB_BY_SEED.map((clubName, index) => ({
      givenName: GIVEN_NAME,
      familyName: String(index + 1).padStart(2, '0'),
      clubId: clubName ? clubIds.get(clubName) : null,
    })),
  );
}

const adminStandings = async (api: Api, leagueId: string, group?: string) =>
  api.json<StandingsPayload>(
    await api.get(
      `admin/leagues/${leagueId}/standings${group ? `?group=${encodeURIComponent(group)}` : ''}`,
    ),
  );

/** Display names in table order — the assertion most of this spec turns on. */
const namesOf = (rows: StandingsRow[]) => rows.map((row) => row.global_persons?.display_name);

/** Total points a club's members hold after `tournaments` identical tournaments. */
const expectedClubPoints = (clubName: string | null, tournaments: number) =>
  CLUB_BY_SEED.reduce(
    (sum, club, index) => (club === clubName ? sum + POINTS_IN_ORDER[index]! * tournaments : sum),
    0,
  );

const seedsIn = (clubName: string | null) =>
  CLUB_BY_SEED.map((club, index) => (club === clubName ? index + 1 : 0)).filter(Boolean);

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('league', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!LEAGUE, 'set E2E_LEAGUE=1 to build a league and score a season for real');

  test('standings are the tournament placements, scored by the league points table', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId, orgId, eventSlug } = runContext();

    const fighters = await leagueRoster(api, eventId);
    const firstTournament = await playTournamentToChampion(api, eventId, {
      name: 'League season — event 1',
      slug: `league-t1-${Date.now().toString(36)}`,
      fighters,
    });

    // The bracket decided this, not the league: seed 1 beat everyone, so the
    // league leader below must be this exact person or the placement is wrong.
    const champion = firstTournament.personByRegistrationId.get(
      firstTournament.championRegistrationId,
    );
    expect(champion, 'champion registration is not in the roster map').toBeDefined();
    expect(personName(champion!)).toBe(personName(fighters[0]!));

    const league = await api.json<LeagueRow>(
      await api.post('admin/leagues', {
        data: {
          name: `E2E TEST (auto) league — ${eventSlug}`,
          slug: `league-${eventSlug}`.slice(0, 100),
          seasonYear: SEASON_YEAR,
          ownerOrganizationId: orgId,
          scoringSystem: 'custom',
          rankingDimensions: 'weapon_category',
          customPointsByRank: POINTS_BY_RANK,
          tieBreakers: ['total_points', 'medal_count'],
        },
      }),
    );
    createdLeagueIds.push(league.id);
    expect(league.status).toBe('draft');

    const group = await api.json<GroupRow>(
      await api.post(`admin/leagues/${league.id}/groups`, { data: { name: GROUP_NAME } }),
    );
    await api.ok(
      await api.post(`admin/leagues/${league.id}/tournaments/${firstTournament.id}/link`, {
        data: { groupId: group.id },
      }),
    );

    fixture = { eventId, fighters, league, groupId: group.id, firstTournament };

    // A linked tournament that has not been counted yet is "pending", not
    // missing — that distinction is what stops a mid-season table looking
    // complete. Recompute is explicit (the event-status ticker calls the same
    // service in production), so before it there is nothing at all.
    const before = await adminStandings(api, league.id);
    expect(before.rows).toEqual([]);
    expect(before.pendingTournaments.map((t) => t.tournamentId)).toEqual([firstTournament.id]);

    const recompute = await api.json<{ recomputedLeagues: string[] }>(
      await api.post(`admin/events/${eventId}/leagues/recompute`, { data: {} }),
    );
    expect(recompute.recomputedLeagues).toContain(league.id);

    const standings = await adminStandings(api, league.id);
    expect(standings.pendingTournaments).toEqual([]);
    expect(standings.rows).toHaveLength(ROSTER_SIZE);

    // Every fighter is ranked once, in the one group the weapon + league group
    // produce.
    expect([...new Set(standings.rows.map((row) => row.ranking_group_key))]).toEqual([GROUP_KEY]);
    expect(standings.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // THE assertion: the lower seed won every match, so the table is seed order.
    expect(namesOf(standings.rows)).toEqual(fighters.map(personName));
    expect(standings.rows[0]!.global_persons?.display_name).toBe(personName(champion!));

    for (const [index, row] of standings.rows.entries()) {
      const place = index + 1;
      expect(row.per_tournament.map((entry) => entry.tournamentId)).toEqual([firstTournament.id]);
      // The placement the league scored is the placement the bracket produced…
      expect(row.per_tournament[0]!.finalRank).toBe(place);
      // …and the points are that placement through the league's own table.
      expect(row.per_tournament[0]!.leaguePoints).toBe(POINTS_BY_RANK[place]);
      expect(row.total_points).toBe(POINTS_BY_RANK[place]);
      expect(row.participation_count).toBe(1);
      expect(row.double_hit_average).toBe('0');
    }

    // Exactly three medals, and only on the real podium: 4th place is a bracket
    // result like any other, not a bronze.
    expect(standings.rows.map((row) => row.medal_count)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);

    // The group filter selects on the same key the rows carry.
    expect((await adminStandings(api, league.id, GROUP_KEY)).rows).toHaveLength(ROSTER_SIZE);
    expect((await adminStandings(api, league.id, 'longsword::nope')).rows).toEqual([]);

    // ── Club standings ───────────────────────────────────────────────────────
    const clubs = await api.json<ClubStandingsPayload>(
      await api.get(`admin/leagues/${league.id}/club-standings`),
    );
    expect(clubs.clubs.map((club) => club.name)).toEqual([CLUB_ALPHA, CLUB_BRAVO]);

    const [alpha, bravo] = clubs.clubs;
    expect(alpha!.totalPoints).toBe(expectedClubPoints(CLUB_ALPHA, 1));
    expect(alpha!.memberCount).toBe(seedsIn(CLUB_ALPHA).length);
    // Alpha holds the whole podium; Bravo holds none of it.
    expect(alpha!.medalCount).toBe(3);
    expect(alpha!.topMembers.map((member) => member.name)).toEqual(
      seedsIn(CLUB_ALPHA).map((seed) => personName(fighters[seed - 1]!)),
    );
    expect(bravo!.totalPoints).toBe(expectedClubPoints(CLUB_BRAVO, 1));
    expect(bravo!.memberCount).toBe(seedsIn(CLUB_BRAVO).length);
    expect(bravo!.medalCount).toBe(0);

    expect(clubs.unaffiliated).toEqual({
      totalPoints: expectedClubPoints(null, 1),
      memberCount: seedsIn(null).length,
      medalCount: 0,
    });

    // ── Public visibility gate + season report ───────────────────────────────
    // Both public reads are gated on `status === 'published' AND
    // public_visibility`, a pair only the service may set — so a draft league is
    // a 404 to the world even though the admin table above is fully populated.
    expect((await api.get(`leagues/${league.id}/standings`)).status()).toBe(404);
    expect((await api.get(`leagues/${league.id}/final-report.csv`)).status()).toBe(404);

    await api.ok(await api.patch(`admin/leagues/${league.id}`, { data: { status: 'published' } }));

    const published = await api.json<StandingsPayload>(
      await api.get(`leagues/${league.id}/standings`),
    );
    expect(namesOf(published.rows)).toEqual(namesOf(standings.rows));

    const csv = await (await api.ok(await api.get(`leagues/${league.id}/final-report.csv`))).text();
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(ROSTER_SIZE + 1);
    // The champion's row, cell for cell — the report is what a federation files.
    expect(lines[1]).toBe(
      [GROUP_KEY, '1', personName(champion!), String(POINTS_BY_RANK[1]), '1', '1', '0'].join(','),
    );
    expect(lines[ROSTER_SIZE]).toBe(
      [
        GROUP_KEY,
        String(ROSTER_SIZE),
        personName(fighters[ROSTER_SIZE - 1]!),
        String(POINTS_BY_RANK[ROSTER_SIZE]),
        '1',
        '0',
        '0',
      ].join(','),
    );

    // Back to draft: the gate must close again, and nothing this spec created is
    // left visible on the public site.
    await api.ok(await api.patch(`admin/leagues/${league.id}`, { data: { status: 'draft' } }));
    expect((await api.get(`leagues/${league.id}/standings`)).status()).toBe(404);
  });

  test('finalize freezes the season, clone carries structure but not results, reopen resumes', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId, fighters, league, groupId } = fixture;

    // A second event of the same season, played by the same fighters to the same
    // placements — so every counted fighter's points must exactly double once it
    // is included, and stay put while the season is frozen.
    const secondTournament = await playTournamentToChampion(api, eventId, {
      name: 'League season — event 2',
      slug: `league-t2-${Date.now().toString(36)}`,
      fighters,
    });
    await api.ok(
      await api.post(`admin/leagues/${league.id}/tournaments/${secondTournament.id}/link`, {
        data: { groupId },
      }),
    );

    const finalized = await api.json<LeagueRow>(
      await api.post(`admin/leagues/${league.id}/finalize`, { data: {} }),
    );
    expect(finalized.finalized_at).not.toBeNull();

    // The manual recompute refuses outright…
    const refused = await api.post(`admin/leagues/${league.id}/recompute`, { data: {} });
    expect(refused.status(), 'recomputing a finalized league must be refused').toBe(400);

    // …and the event-level recompute — the one a late event ticking over calls —
    // skips the league silently rather than rewriting its results.
    const skipped = await api.json<{ recomputedLeagues: string[] }>(
      await api.post(`admin/events/${eventId}/leagues/recompute`, { data: {} }),
    );
    expect(skipped.recomputedLeagues).not.toContain(league.id);

    const frozen = await adminStandings(api, league.id);
    expect(namesOf(frozen.rows)).toEqual(fighters.map(personName));
    expect(frozen.rows.map((row) => row.total_points)).toEqual(POINTS_IN_ORDER);
    expect(frozen.rows.map((row) => row.participation_count)).toEqual(
      Array(ROSTER_SIZE).fill(1) as number[],
    );
    expect(frozen.pendingTournaments.map((t) => t.tournamentId)).toEqual([secondTournament.id]);

    // ── Clone the frozen season into the next one ────────────────────────────
    const clone = await api.json<LeagueRow>(
      await api.post(`admin/leagues/${league.id}/clone`, {
        data: { seasonYear: SEASON_YEAR + 1, name: `${league.name} (next season)` },
      }),
    );
    createdLeagueIds.push(clone.id);

    expect(clone.id).not.toBe(league.id);
    expect(clone.slug).not.toBe(league.slug);
    expect(clone.season_year).toBe(SEASON_YEAR + 1);
    // A new season starts open and unpublished, whatever state the source is in.
    expect(clone.status).toBe('draft');
    expect(clone.public_visibility).toBe(false);
    expect(clone.finalized_at).toBeNull();
    // Configuration carries over verbatim, so next season scores the same way.
    expect(clone.scoring_config).toEqual(finalized.scoring_config);

    // Structure carries over as NEW rows, not shared ones.
    const cloneGroups = await api.json<GroupRow[]>(
      await api.get(`admin/leagues/${clone.id}/groups`),
    );
    expect(cloneGroups.map((g) => g.name)).toEqual([GROUP_NAME]);
    expect(cloneGroups[0]!.id).not.toBe(groupId);

    // Results do not: a cloned season is empty until it is played.
    expect((await adminStandings(api, clone.id)).rows).toEqual([]);
    expect(
      await api.json<unknown[]>(await api.get(`admin/leagues/${clone.id}/tournament-links`)),
    ).toEqual([]);

    // ── Reopen: recompute resumes and the second event finally counts ────────
    await api.ok(await api.post(`admin/leagues/${league.id}/reopen`, { data: {} }));
    const resumed = await api.json<{ recomputedLeagues: string[] }>(
      await api.post(`admin/events/${eventId}/leagues/recompute`, { data: {} }),
    );
    expect(resumed.recomputedLeagues).toContain(league.id);

    const merged = await adminStandings(api, league.id);
    expect(merged.pendingTournaments).toEqual([]);
    // Same fighters, same order — two identical tournaments cannot reshuffle it.
    expect(namesOf(merged.rows)).toEqual(fighters.map(personName));
    expect(merged.rows.map((row) => row.participation_count)).toEqual(
      Array(ROSTER_SIZE).fill(2) as number[],
    );
    expect(merged.rows.map((row) => row.total_points)).toEqual(
      POINTS_IN_ORDER.map((points) => points * 2),
    );
    expect(merged.rows.map((row) => row.medal_count)).toEqual([2, 2, 2, 0, 0, 0, 0, 0]);
    for (const row of merged.rows) {
      expect(row.per_tournament.map((entry) => entry.tournamentId).sort()).toEqual(
        [fixture.firstTournament.id, secondTournament.id].sort(),
      );
    }

    // Club totals follow the fighter table, so they double too.
    const clubs = await api.json<ClubStandingsPayload>(
      await api.get(`admin/leagues/${league.id}/club-standings`),
    );
    expect(clubs.clubs.map((club) => club.totalPoints)).toEqual([
      expectedClubPoints(CLUB_ALPHA, 2),
      expectedClubPoints(CLUB_BRAVO, 2),
    ]);
  });

  /**
   * A league outlives the throwaway event (nothing links it to one), so it has to
   * clean up after itself. Deleting cascades its groups, links, results and
   * rankings. Preserved by default, like the event, so a local run can be
   * inspected — and harmless either way, since the league is left as a draft.
   */
  test.afterAll(async () => {
    if (createdLeagueIds.length === 0) return;
    const { baseURL, orgSlug } = runContext();
    if (!CLEANUP) {
      console.log(
        `[e2e] leagues PRESERVED — open them in the admin UI:\n` +
          createdLeagueIds
            .map((id) => `        ${baseURL}/org/${orgSlug}/leagues/${id}`)
            .join('\n') +
          `\n        (run with E2E_CLEANUP=1 to delete them instead)`,
      );
      return;
    }
    const ctx = await apiRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    for (const id of createdLeagueIds) {
      const res = await ctx.delete(`/api/v1/admin/leagues/${id}`);
      if (!res.ok()) console.warn(`[e2e] could not delete league ${id}: ${res.status()}`);
    }
    await ctx.dispose();
  });
});
