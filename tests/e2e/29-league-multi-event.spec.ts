import { randomUUID } from 'node:crypto';
import { test, expect, request as apiRequest } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureClub, ensureRoster, personName, type Person } from './_bracket';
import { playTournamentToChampion, type FinishedTournament } from './_tournament';

/**
 * A league that spans SEVERAL EVENTS, and the scoring that aggregates them.
 *
 * `11-league.spec.ts` already links two tournaments to a league — but both sit in
 * the same event, with the same roster finishing in the same order, so every
 * total simply doubles and no two fighters are ever tied. It proves placement →
 * points. It cannot prove aggregation, because there is nothing to aggregate
 * that is not a duplicate of what came before.
 *
 * Four things only a multi-event season reaches, every one of them silent when
 * wrong — points that never appear, or an order that looks perfectly plausible:
 *
 *   - the same fighter placing DIFFERENTLY in different events, and a fighter
 *     absent from one;
 *   - the tie-break ladder, `total_points → participation_count → medal_count →
 *     double_hit_average`, and the alphabetical fallback under it — unit-tested
 *     only over hand-built rows, and DEAD in the path that writes standings
 *     until this spec found it;
 *   - `POST admin/leagues/:id/events/:eventId/link`, its group, and its bulk
 *     DELETE — none of which any test in the repo called;
 *   - the `event_kind` gate: `leagues.service.ts` drops a tournament's ENTIRE
 *     contribution when `countsTowardStats` is false (`kind === 'standard'`).
 *     A club-kind event stays linked and listed, and its points are simply gone.
 *
 * ## Two mechanics the design is built around
 *
 * **Identity is name + club.** A contribution's `fighterId` is
 * `persons.global_person_id`, and `resolveOrCreateGlobalPerson` matches on HEMA
 * Ratings id, then name + club + date of birth. A CLUB-LESS fighter therefore
 * mints a FRESH global identity in every event, and a season would silently
 * split into one single-event row per person instead of aggregating. Every
 * fighter here has a club for that reason, and the spec asserts the global ids
 * really did match across events before it asserts anything about points.
 *
 * **Rank 5–8 is decided by NAME.** With no pools, `computeFinalRanking` orders
 * everyone eliminated in the same round by pool score and then by
 * `fighterName.localeCompare` — so a tail seeded 5..8 only finishes 5..8 if its
 * names sort that way too. Hence the filler names: `Zz …` sorts after every core
 * name, and ascending within an event, so the tail order is the seed order in
 * every lineup below. The per-tournament placement check exists to catch it
 * loudly if that ever stops being true.
 *
 * One thing NOT asserted, because it cannot happen: tied fighters sharing a rank.
 * `compareRankings` never returns 0 for two different fighters, so the
 * equal-rank branch of `computeRankingsFromContributions` is unreachable. The
 * alphabetical fallback is pinned instead.
 *
 * The three defects this spec found — the bulk unlink leaving its points
 * behind, the tie-break ordering by UUID, and the bulk link losing its group —
 * are fixed and green. The last assertion, that the bulk link still accepts a
 * request with NO body, is red until the deploy after them: giving that route a
 * Zod DTO class to carry the group put a validation pipe in front of it, and a
 * pipe fed an absent body rejects it before the handler runs.
 */

const LEAGUE = ['1', 'true', 'yes'].includes((process.env.E2E_LEAGUE ?? '').toLowerCase());
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

/** Given name of every fighter; the family name carries the identity. */
const GIVEN_NAME = 'Multi';

/**
 * One club for everyone. Not decoration: it is what makes `Multi Alpha` in event
 * 1 and `Multi Alpha` in event 2 the same global person, and so the only reason
 * any total below is a sum rather than two separate rows.
 */
const CLUB_NAME = 'E2E Multi-Event Club';

/**
 * Chosen so equal sums are reachable with DIFFERENT medal counts, which is the
 * only way to isolate the `medal_count` rung: 3rd + 5th (30 + 20) equals
 * 4th + 4th (25 + 25), one medal against none.
 */
const POINTS_BY_RANK: Readonly<Record<number, number>> = {
  1: 100,
  2: 50,
  3: 30,
  4: 25,
  5: 20,
  6: 15,
  7: 10,
  8: 5,
};

/** Ranks that carry a medal — bronze mode gives 3rd a real match, 4th none. */
const MEDAL_RANKS = new Set([1, 2, 3]);

const SEASON_YEAR = 2098;

/**
 * This league has NO groups at all, and that is the key it produces.
 *
 * Aggregation keys on `${rankingGroupKey}:${fighterId}`, and the key is the
 * weapon plus the group NAME — so a league holding both grouped and group-less
 * links splits any fighter in both into two half-rows. A league with no groups
 * cannot have that mix: every link resolves to null and every key agrees.
 *
 * That keeps this spec measuring aggregation rather than grouping, which
 * `11-league` covers. The bulk endpoint's own group handling is asserted at the
 * end, on a separate league, precisely so it cannot disturb these keys.
 */
const GROUP_KEY = 'longsword::unknown';

/**
 * Seed order per event, by family name. Index 0 is seed 1.
 *
 * Every placement in the expected table follows from these three rows and
 * `POINTS_BY_RANK` — the lower seed wins every match, so finishing order IS this
 * order. Read them as the design: who meets whom, and who skips what.
 *
 *   Alpha    100          (one event only — the participation_count rung)
 *   Bravo     50 + 50     (same points as Alpha, twice the attendance)
 *   Charlie   30 + 20     ┐
 *   Echo      30 + 20     │ all 50 points over two events: the medal_count,
 *   Foxtrot   30 + 20     │ double_hit_average and name rungs
 *   Delta     25 + 25     ┘
 *
 * Fillers make each field up to eight and take the ranks nobody is contending.
 */
const LINEUPS: ReadonlyArray<{ key: string; families: readonly string[] }> = [
  {
    key: 'E1',
    families: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Foxtrot', 'Zz E1 06', 'Zz E1 07', 'Zz E1 08'],
  },
  {
    key: 'E2',
    families: ['Zz E2 01', 'Bravo', 'Echo', 'Delta', 'Charlie', 'Zz E2 06', 'Zz E2 07', 'Zz E2 08'],
  },
  {
    key: 'E3',
    families: [
      'Zz E3 01',
      'Zz E3 02',
      'Foxtrot',
      'Zz E3 04',
      'Echo',
      'Zz E3 06',
      'Zz E3 07',
      'Zz E3 08',
    ],
  },
];

/**
 * The fighter given a double, and the event it happens in.
 *
 * A `double` exchange credits BOTH sides of its match (`doubleHitsByRegistration`),
 * so it is posted into Foxtrot's first-round bout — seed 3 against seed 6 — where
 * the opponent is a filler nobody is tied with. Foxtrot's average becomes 1/2,
 * the filler's 1/1, and both are in the expected table below.
 */
const DOUBLED_FAMILY = 'Foxtrot';
const DOUBLED_EVENT_KEY = 'E3';
const DOUBLED_OPPONENT_FAMILY = 'Zz E3 06';

/**
 * The whole table as TIERS, hand-derived from the lineups above. Each tier is a
 * set of fighters the ladder cannot separate; the order OF the tiers is what the
 * ladder decides, and that is what is asserted.
 *
 *   Bravo over Alpha's tier   — same 100 points, two events against one
 *   Charlie + Echo            — identical on every rung, so the ladder stops
 *   Foxtrot                   — same again, but one double: 0.5 beats it down
 *   Delta                     — same points and attendance, no medal
 *   the 15s split by doubles  — the doubled filler falls behind the clean ones
 *
 * **Why tiers rather than one flat order.** The tiers are what the LADDER
 * decides, and they hold whatever the last resort does. Within a tier the order
 * is asserted separately, as alphabetical — see the check below the tier loop.
 *
 * That split exists because the two are proved by different things. The tier
 * boundaries follow from the lineups and were green from the first run; the
 * within-tier order depends on `recomputeLeagueRankings` carrying real names,
 * which it did not until this spec found it passing `fighterName: ''` for every
 * contribution and leaving tied fighters ordered by their global-person UUIDs.
 */
const EXPECTED_TIERS: ReadonlyArray<readonly string[]> = [
  ['Bravo'],
  ['Alpha', 'Zz E2 01', 'Zz E3 01'],
  ['Charlie', 'Echo'],
  ['Foxtrot'],
  ['Delta'],
  ['Zz E3 02'],
  ['Zz E3 04'],
  ['Zz E1 06', 'Zz E2 06'],
  ['Zz E3 06'],
  ['Zz E1 07', 'Zz E2 07', 'Zz E3 07'],
  ['Zz E1 08', 'Zz E2 08', 'Zz E3 08'],
];

const EXPECTED_SIZE = EXPECTED_TIERS.reduce((sum, tier) => sum + tier.length, 0);

// ── API shapes ───────────────────────────────────────────────────────────────

interface LeagueRow {
  id: string;
  status: string;
}

interface StandingsRow {
  ranking_group_key: string;
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

interface EventRow {
  id: string;
}

// ── Derived expectations ─────────────────────────────────────────────────────

const displayName = (family: string) => `${GIVEN_NAME} ${family}`;

/** Every event a family fights in, with the rank they finish at. */
function placementsOf(family: string): Array<{ key: string; rank: number }> {
  return LINEUPS.flatMap((lineup) => {
    const index = lineup.families.indexOf(family);
    return index >= 0 ? [{ key: lineup.key, rank: index + 1 }] : [];
  });
}

/** Points, attendance and medals a family holds, summed over the events they entered. */
function expectedTotals(family: string, includedKeys: readonly string[]) {
  const placements = placementsOf(family).filter((p) => includedKeys.includes(p.key));
  return {
    totalPoints: placements.reduce((sum, p) => sum + POINTS_BY_RANK[p.rank]!, 0),
    participationCount: placements.length,
    medalCount: placements.filter((p) => MEDAL_RANKS.has(p.rank)).length,
  };
}

/** Doubles credited to a family, which only the doubled bout produces. */
function expectedDoubles(family: string, includedKeys: readonly string[]): number {
  if (!includedKeys.includes(DOUBLED_EVENT_KEY)) return 0;
  return family === DOUBLED_FAMILY || family === DOUBLED_OPPONENT_FAMILY ? 1 : 0;
}

/** Families that appear in at least one of `includedKeys`. */
function familiesIn(includedKeys: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const lineup of LINEUPS) {
    if (!includedKeys.includes(lineup.key)) continue;
    for (const family of lineup.families) seen.add(family);
  }
  return [...seen];
}

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('league across several events', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!LEAGUE, 'set E2E_LEAGUE=1 to score a multi-event league season for real');

  const createdEventIds: string[] = [];
  const createdLeagueIds: string[] = [];

  test('several events aggregate into one table, and every tie-break decides it', async ({
    request,
  }) => {
    test.setTimeout(1_800_000);
    const api = apiFor(request);
    const { orgId, eventSlug } = runContext();
    const token = Date.now().toString(36);

    const clubId = await ensureClub(api, CLUB_NAME);

    // ── Three events, each holding one played tournament ─────────────────────
    // `standard` because that is the only kind `countsTowardStats` accepts, and
    // never published: publishing a standard event announces it to the
    // organisation's followers, and league scoring does not need it.
    const tournaments = new Map<string, FinishedTournament>();
    const eventIdByKey = new Map<string, string>();
    const personsByKey = new Map<string, Person[]>();

    for (const lineup of LINEUPS) {
      const event = await api.json<EventRow>(
        await api.post(`organizations/${orgId}/events`, {
          data: {
            name: `E2E TEST (auto) multi-league ${lineup.key} — ${token}`,
            slug: `e2e-multi-${lineup.key.toLowerCase()}-${token}`,
            startDate: '2098-03-01',
            endDate: '2098-03-02',
            city: 'Testville',
            country: 'FR',
          },
        }),
      );
      createdEventIds.push(event.id);
      eventIdByKey.set(lineup.key, event.id);

      const fighters = await ensureRoster(
        api,
        event.id,
        lineup.families.map((family) => ({ givenName: GIVEN_NAME, familyName: family, clubId })),
      );
      personsByKey.set(lineup.key, fighters);

      tournaments.set(
        lineup.key,
        await playTournamentToChampion(api, event.id, {
          name: `Multi league ${lineup.key}`,
          slug: `multi-league-${lineup.key.toLowerCase()}-${token}`,
          fighters,
        }),
      );
    }

    // The premise of every sum below: the same human is the same fighter in all
    // three events. Club-less people would mint a fresh global identity per
    // event and the season would quietly become nineteen single-event rows.
    const globalIdsByFamily = new Map<string, Set<string>>();
    for (const lineup of LINEUPS) {
      const rows = await api.json<
        Array<{ id: string; familyName: string; globalPersonId: string }>
      >(await api.get(`events/${eventIdByKey.get(lineup.key)}/persons`));
      for (const row of rows) {
        const set = globalIdsByFamily.get(row.familyName) ?? new Set<string>();
        set.add(row.globalPersonId);
        globalIdsByFamily.set(row.familyName, set);
      }
    }
    for (const family of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']) {
      expect(
        [...(globalIdsByFamily.get(family) ?? [])],
        `${displayName(family)} must be ONE global person across the events — ` +
          `more than one id here means identity resolution stopped matching on name + club`,
      ).toHaveLength(1);
    }

    // ── The deliberate double ────────────────────────────────────────────────
    // Posted after play: `createExchange` guards frozen results and the lock,
    // not completion, and a double scores nobody, so the finished result stands.
    const doubledTournament = tournaments.get(DOUBLED_EVENT_KEY)!;
    const doubledPerson = personsByKey
      .get(DOUBLED_EVENT_KEY)!
      .find((p) => p.familyName === DOUBLED_FAMILY)!;
    const doubledRegistrationId = [...doubledTournament.personByRegistrationId.entries()].find(
      ([, person]) => person.id === doubledPerson.id,
    )?.[0];
    expect(doubledRegistrationId, `${DOUBLED_FAMILY} has no registration`).toBeTruthy();

    const doubledSlot = doubledTournament.bracket.slots.find(
      (slot) =>
        slot.matchId &&
        (slot.redRegistrationId === doubledRegistrationId ||
          slot.blueRegistrationId === doubledRegistrationId),
    );
    expect(doubledSlot?.matchId, `no bout found for ${DOUBLED_FAMILY}`).toBeTruthy();

    // The opponent is asserted, not assumed: the expected table names them, and
    // the double lands on BOTH sides of whichever bout this is.
    const opponentRegistrationId =
      doubledSlot!.redRegistrationId === doubledRegistrationId
        ? doubledSlot!.blueRegistrationId
        : doubledSlot!.redRegistrationId;
    const opponent = doubledTournament.personByRegistrationId.get(opponentRegistrationId as string);
    expect(
      opponent?.familyName,
      'the doubled bout must be against the filler the expected table names',
    ).toBe(DOUBLED_OPPONENT_FAMILY);

    await api.ok(
      await api.post(`matches/${doubledSlot!.matchId}/exchanges`, {
        data: {
          clientUuid: randomUUID(),
          // Well clear of the clean hits `scoreMatch` posted as 1..N; `exchanges`
          // has no uniqueness on (match_id, sequence), and ordering is irrelevant
          // to a double, which scores nobody.
          sequence: 900,
          type: 'double',
          occurredAt: new Date().toISOString(),
          clockTimeMs: 240_000,
        },
      }),
    );

    // ── The league ───────────────────────────────────────────────────────────
    const league = await api.json<LeagueRow>(
      await api.post('admin/leagues', {
        data: {
          name: `E2E TEST (auto) multi-event league — ${token}`,
          slug: `multi-league-${token}`.slice(0, 100),
          seasonYear: SEASON_YEAR,
          ownerOrganizationId: orgId,
          scoringSystem: 'custom',
          rankingDimensions: 'weapon_category',
          customPointsByRank: POINTS_BY_RANK,
          // All four rungs, in order, so the ladder below is the league's own
          // configuration rather than whatever the registry defaults to today.
          tieBreakers: ['total_points', 'participation_count', 'medal_count', 'double_hit_average'],
        },
      }),
    );
    createdLeagueIds.push(league.id);

    // E1 through the BULK event link, the rest per tournament: both paths reach
    // the same table, and only one of them had ever been called by anything.
    // Neither carries a group — see GROUP_KEY for why mixing the two would split
    // a fighter's season in half.
    // Sends `{}` rather than nothing, deliberately: this call is SETUP, and a
    // setup call that is gated on a deployment blocks every assertion below it
    // from ever running. The body-less form — which a Zod DTO class on this
    // route would reject outright — is covered at the end, where being red
    // costs only itself.
    await api.ok(
      await api.post(`admin/leagues/${league.id}/events/${eventIdByKey.get('E1')}/link`, {
        data: {},
      }),
    );
    for (const key of ['E2', 'E3']) {
      await api.ok(
        await api.post(`admin/leagues/${league.id}/tournaments/${tournaments.get(key)!.id}/link`, {
          data: {},
        }),
      );
    }

    const standings = async () =>
      api.json<StandingsPayload>(await api.get(`admin/leagues/${league.id}/standings`));

    /**
     * The two recompute endpoints are NOT interchangeable, and only one ingests.
     *
     * `admin/leagues/:id/recompute` RE-RANKS from rows already stored in
     * `league_tournament_results` — it never reads a tournament. The per-event
     * one computes contributions from registrations and placements and writes
     * those rows, and it is what production's event-status ticker calls. A spec
     * that calls only the league-wide one watches an empty season forever.
     */
    const recompute = async () => {
      for (const lineup of LINEUPS) {
        await api.ok(
          await api.post(`admin/events/${eventIdByKey.get(lineup.key)}/leagues/recompute`, {
            data: {},
          }),
        );
      }
    };

    await recompute();
    const full = await standings();

    // ── The precondition: the placement the league scored ────────────────────
    // Asserted before anything is summed. If the tail ever stops finishing in
    // seed order — the name rule in `computeFinalRanking` — this says so at the
    // event and the fighter, instead of surfacing as an unreadable table diff.
    const rowByName = new Map(full.rows.map((row) => [row.global_persons?.display_name, row]));
    const tournamentIdByKey = new Map(
      [...tournaments.entries()].map(([key, tournament]) => [tournament.id, key]),
    );
    for (const lineup of LINEUPS) {
      for (const [index, family] of lineup.families.entries()) {
        const row = rowByName.get(displayName(family));
        expect(row, `${displayName(family)} is missing from the standings`).toBeDefined();
        const entry = row!.per_tournament.find(
          (e) => tournamentIdByKey.get(e.tournamentId) === lineup.key,
        );
        expect(
          entry?.finalRank,
          `${displayName(family)} was seeded ${index + 1} in ${lineup.key} and must finish there`,
        ).toBe(index + 1);
        expect(entry?.leaguePoints).toBe(POINTS_BY_RANK[index + 1]);
      }
    }

    // ── The aggregate, per fighter ───────────────────────────────────────────
    const allKeys = LINEUPS.map((l) => l.key);
    for (const family of familiesIn(allKeys)) {
      const row = rowByName.get(displayName(family))!;
      const expected = expectedTotals(family, allKeys);
      expect(row.total_points, `${family} total`).toBe(expected.totalPoints);
      expect(row.participation_count, `${family} participation`).toBe(expected.participationCount);
      expect(row.medal_count, `${family} medals`).toBe(expected.medalCount);
      expect(Number(row.double_hit_average), `${family} double-hit average`).toBeCloseTo(
        expectedDoubles(family, allKeys) / expected.participationCount,
        5,
      );
    }

    // ── The ties are ties ────────────────────────────────────────────────────
    // Each rung is only proved if the fighters really are level on everything
    // above it. Asserted explicitly, so a table that accidentally separates them
    // earlier can never pass as a tie-break proof.
    const at = (family: string) => rowByName.get(displayName(family))!;

    expect(at('Bravo').total_points, 'participation rung needs equal points').toBe(
      at('Alpha').total_points,
    );
    expect(at('Bravo').participation_count).toBeGreaterThan(at('Alpha').participation_count);
    expect(at('Bravo').rank, 'more events must win a points tie').toBeLessThan(at('Alpha').rank);

    for (const family of ['Echo', 'Foxtrot', 'Delta']) {
      expect(at(family).total_points, `medal/double rungs need ${family} level on points`).toBe(
        at('Charlie').total_points,
      );
      expect(at(family).participation_count).toBe(at('Charlie').participation_count);
    }
    expect(at('Charlie').medal_count).toBeGreaterThan(at('Delta').medal_count);
    expect(at('Charlie').rank, 'a medal must win a points + attendance tie').toBeLessThan(
      at('Delta').rank,
    );

    expect(at('Foxtrot').medal_count, 'the double rung needs equal medals').toBe(
      at('Charlie').medal_count,
    );
    expect(Number(at('Foxtrot').double_hit_average)).toBeGreaterThan(
      Number(at('Charlie').double_hit_average),
    );
    expect(at('Charlie').rank, 'fewer doubles must win a medal tie').toBeLessThan(
      at('Foxtrot').rank,
    );

    // The bottom of the ladder: Charlie and Echo are level on all four rungs, so
    // nothing the league is configured with can separate them. They must land
    // ADJACENT — the ladder placing anything between two fighters it cannot tell
    // apart would mean it separated them on something it does not claim to use.
    expect(Number(at('Echo').double_hit_average), 'the last rung needs equal averages').toBe(
      Number(at('Charlie').double_hit_average),
    );
    expect(
      Math.abs(at('Charlie').rank - at('Echo').rank),
      'two fighters level on every rung must be adjacent',
    ).toBe(1);

    // ── The table, tier by tier ──────────────────────────────────────────────
    expect([...new Set(full.rows.map((row) => row.ranking_group_key))]).toEqual([GROUP_KEY]);
    expect(full.rows).toHaveLength(EXPECTED_SIZE);

    const namesInOrder = full.rows.map((row) => row.global_persons?.display_name);
    let cursor = 0;
    for (const [index, tier] of EXPECTED_TIERS.entries()) {
      const slice = namesInOrder.slice(cursor, cursor + tier.length);
      expect(
        [...slice].sort(),
        `tier ${index + 1} (ranks ${cursor + 1}–${cursor + tier.length}) must hold exactly ${tier.join(', ')}`,
      ).toEqual([...tier.map(displayName)].sort());
      cursor += tier.length;
    }

    // Every rank distinct: `compareRankings` never returns 0 for two different
    // fighters, so the equal-rank branch of the ranker is unreachable in practice.
    expect(full.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: EXPECTED_SIZE }, (_, i) => i + 1),
    );

    // Within a tier the ladder has nothing left to compare, so the configured
    // last resort decides: alphabetical order.
    //
    // This is the assertion that catches the tie-break going dead again.
    // `recomputeLeagueRankings` is the only path that writes standings, and it
    // used to hand `fighterName: ''` to the ranker for every row — so the name
    // comparison always returned 0 and the real order came from the fighters'
    // global-person UUIDs. Fixed by embedding the display name; **red until the
    // API carrying that fix is deployed.**
    let alphaCursor = 0;
    for (const tier of EXPECTED_TIERS) {
      if (tier.length > 1) {
        const slice = namesInOrder.slice(alphaCursor, alphaCursor + tier.length);
        expect(
          slice,
          `fighters level on every rung must be alphabetical, not in id order: ${slice.join(', ')}`,
        ).toEqual([...slice].sort((a, b) => (a ?? '').localeCompare(b ?? '')));
      }
      alphaCursor += tier.length;
    }

    // And the whole table must not move when nothing changed — an order that
    // reshuffles on every recompute has organisers watching fighters swap places
    // for no reason.
    await recompute();
    expect(
      (await standings()).rows.map((row) => row.global_persons?.display_name),
      'recomputing an unchanged season must not reshuffle it',
    ).toEqual(namesInOrder);

    // ── The event_kind gate ──────────────────────────────────────────────────
    // A club event is real activity that does not count. The link stays; the
    // points vanish. Nothing anywhere says so — which is the whole problem.
    const e3 = eventIdByKey.get('E3')!;
    await api.ok(await api.patch(`events/${e3}`, { data: { eventKind: 'club' } }));
    await recompute();
    const withoutE3 = await standings();

    const keysWithoutE3 = ['E1', 'E2'];
    const survivingRow = new Map(
      withoutE3.rows.map((row) => [row.global_persons?.display_name, row]),
    );
    for (const family of familiesIn(allKeys)) {
      const expected = expectedTotals(family, keysWithoutE3);
      const row = survivingRow.get(displayName(family));
      if (expected.participationCount === 0) {
        expect(
          row,
          `${family} only fought the club event and must leave the table`,
        ).toBeUndefined();
        continue;
      }
      expect(row!.total_points, `${family} total without the club event`).toBe(
        expected.totalPoints,
      );
      expect(row!.participation_count).toBe(expected.participationCount);
    }
    // The link survives; only the CONTRIBUTION is dropped. The tournament falls
    // back to "pending" — linked, uncounted — which is the one visible trace an
    // organiser gets. It does not say WHY, and the kind is the only explanation.
    expect(
      withoutE3.pendingTournaments.map((t) => t.tournamentId),
      'a club event stays linked, and reads as pending rather than vanishing',
    ).toContain(tournaments.get('E3')!.id);

    await api.ok(await api.patch(`events/${e3}`, { data: { eventKind: 'standard' } }));
    await recompute();
    const restored = await standings();
    // Compared against the order actually observed before the flip, not against
    // the tiers: this has to come back EXACTLY, down to the within-tier order.
    expect(
      restored.rows.map((row) => row.global_persons?.display_name),
      'restoring the kind must restore the table exactly',
    ).toEqual(namesInOrder);

    // ── Bulk unlink ──────────────────────────────────────────────────────────
    //
    // This section found a real defect on its first run against a real database.
    //
    // `removeEventTournamentLinks` marked each link `removed` and nothing else.
    // It never deleted that tournament's `league_tournament_results` rows, and
    // `recomputeForEvent` only processes links whose status is `approved` — so
    // the event just unlinked could never again trigger the cleanup of its own
    // rows, and `recomputeLeagueRankings` kept re-ranking from them. An organiser
    // removed an event from a season and every total kept its points, with no
    // error and nothing on screen to suggest the table had stopped being true.
    //
    // Fixed in `leagues.service.ts` at the source — a link leaving `approved`
    // drops its results and re-ranks — rather than filtering at read time, which
    // would have left the stale rows behind to be rediscovered later. **This
    // assertion stays red until the API carrying that fix is deployed.**
    const e2 = eventIdByKey.get('E2')!;
    await api.ok(await api.delete(`admin/leagues/${league.id}/events/${e2}/tournament-links`));

    // Split from the points assertion on purpose: this half proves the unlink
    // itself worked, so a failure below can only be the standings keeping what
    // the league no longer holds.
    // Raw rows, so snake_case: `listTournamentLinks` selects `*` with embeds and
    // does not project to camelCase. Reading `tournamentId` here would find
    // nothing and pass this assertion without testing anything.
    const links = await api.json<
      Array<{ tournament_id: string; status: string; group_id: string | null }>
    >(await api.get(`admin/leagues/${league.id}/tournament-links`));
    const e2Link = links.find((link) => link.tournament_id === tournaments.get('E2')!.id);
    expect(e2Link, 'the link must still be listed after a bulk unlink').toBeDefined();
    expect(e2Link!.status, 'the bulk unlink must actually remove the link').not.toBe('approved');

    await recompute();
    const withoutE2 = await standings();

    const keysWithoutE2 = ['E1', 'E3'];
    const afterUnlink = new Map(
      withoutE2.rows.map((row) => [row.global_persons?.display_name, row]),
    );
    for (const family of familiesIn(allKeys)) {
      const expected = expectedTotals(family, keysWithoutE2);
      const row = afterUnlink.get(displayName(family));
      if (expected.participationCount === 0) {
        expect(row, `${family} only fought the unlinked event`).toBeUndefined();
        continue;
      }
      expect(row!.total_points, `${family} total after the bulk unlink`).toBe(expected.totalPoints);
    }

    // ── The bulk link carries a group ────────────────────────────────────────
    //
    // On its own league, because the season above is deliberately group-less:
    // this is about the LINK, not the standings, and adding a group to that
    // league would change every ranking key it was just measured with.
    //
    // The endpoint used to take no body at all, so it could only ever create
    // UNGROUPED links. A league with groups then held both, in two different
    // ranking buckets, and any fighter in both was split into two half-rows.
    // **Red until the API carrying the fix is deployed** — before it, the group
    // is dropped and this reads null.
    const grouped = await api.json<LeagueRow>(
      await api.post('admin/leagues', {
        data: {
          name: `E2E TEST (auto) grouped-link league — ${token}`,
          slug: `multi-league-grouped-${token}`.slice(0, 100),
          seasonYear: SEASON_YEAR,
          ownerOrganizationId: orgId,
          scoringSystem: 'custom',
          rankingDimensions: 'weapon_category',
          customPointsByRank: POINTS_BY_RANK,
        },
      }),
    );
    createdLeagueIds.push(grouped.id);

    const groupA = await api.json<{ id: string }>(
      await api.post(`admin/leagues/${grouped.id}/groups`, { data: { name: 'Open' } }),
    );
    await api.ok(
      await api.post(`admin/leagues/${grouped.id}/groups`, { data: { name: 'Steel Open' } }),
    );

    await api.ok(
      await api.post(`admin/leagues/${grouped.id}/events/${eventIdByKey.get('E1')}/link`, {
        data: { groupId: groupA.id },
      }),
    );
    const groupedLinks = await api.json<Array<{ tournament_id: string; group_id: string | null }>>(
      await api.get(`admin/leagues/${grouped.id}/tournament-links`),
    );
    const bulkLink = groupedLinks.find((link) => link.tournament_id === tournaments.get('E1')!.id);
    expect(
      bulkLink?.group_id,
      'a bulk event link must land in the group it was given, not the unknown bucket',
    ).toBe(groupA.id);

    // And the body stays OPTIONAL. "Link everything from this event" never
    // needed one, so a caller that sends nothing must still be served — the
    // regression that appears the moment this route is given a Zod DTO class,
    // because the validation pipe rejects an absent body before the handler is
    // reached. **Red until the API carrying that fix is deployed.**
    const bodyless = await api.post(
      `admin/leagues/${grouped.id}/events/${eventIdByKey.get('E2')}/link`,
    );
    expect(
      bodyless.status(),
      'the bulk link must accept a request with no body at all',
    ).toBeLessThan(300);
  });

  test.afterAll(async () => {
    const { baseURL } = runContext();
    const ctx = await apiRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    const api = apiFor(ctx);

    // The events are `standard` and hold scored matches, so they refuse a hard
    // delete outright. Flipping to `test` is the LAST thing that happens — the
    // kind is load-bearing for every assertion above — and is what makes them
    // disposable at all.
    for (const eventId of createdEventIds) {
      const flipped = await api.patch(`events/${eventId}`, { data: { eventKind: 'test' } });
      if (!flipped.ok()) {
        console.warn(`[e2e] could not flip event ${eventId} to test kind: ${flipped.status()}`);
        continue;
      }
      if (!CLEANUP) continue;
      const deleted = await api.delete(`events/${eventId}?mode=hard`);
      if (!deleted.ok())
        console.warn(`[e2e] could not delete event ${eventId}: ${deleted.status()}`);
    }

    // A league outlives the events it scored, so it has to be cleaned up on its
    // own terms — and returned to draft either way, so nothing this spec built
    // is ever left publicly visible.
    for (const leagueId of createdLeagueIds) {
      await api.patch(`admin/leagues/${leagueId}`, { data: { status: 'draft' } });
      if (CLEANUP) {
        const deleted = await api.delete(`admin/leagues/${leagueId}`);
        if (!deleted.ok()) console.warn(`[e2e] could not delete league ${leagueId}`);
      } else {
        console.log(`[e2e] league PRESERVED: ${baseURL}/admin/leagues/${leagueId}`);
      }
    }
    if (!CLEANUP && createdEventIds.length > 0) {
      console.log(
        `[e2e] multi-event league events PRESERVED (kind=test): ${createdEventIds.join(', ')}`,
      );
    }
    await ctx.dispose();
  });
});
