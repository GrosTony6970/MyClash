import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';
import { poll, readOverallStandings } from './_pool';
import { publishTournamentAndEvent } from './_tournament';
import {
  createTeamPoolTournament,
  generateTeamBracket,
  playTeamBracket,
  playTeamPools,
  readTeamPoolBouts,
  type TeamTournament,
} from './_team';

/**
 * A team Tournament from its Pools to its champion, and on to the public final ranking
 * (run with E2E_TEAM_TOURNAMENT=1).
 *
 * Four made-up teams seeded 1 to 4 (`_team.ts`), one Pool, every bout scored through the API the
 * way the pad scores it, the lower seed winning. The Pool then ranks the teams in seed order, the
 * single elimination bracket of four is seeded from it (semi-finals 1-4 and 2-3, a final, a bronze
 * bout), and the lower seed wins again. So the champion is seed 1, and the final ranking reads
 * seed 1, 2, 3, 4: the bronze bout decides 3 and 4.
 *
 * What only a whole run reaches: the bracket advances by side, a team side, through the final and
 * the bronze bout; the Tournament completes by itself once its bracket has a champion (ruling 892,
 * `tournament-completion.service.ts`), which needs a published Tournament; and the public site
 * computes its final ranking in the browser from the bracket rows the API sends by side
 * (`computeFinalRanking`). The ranking's Pool scores come from a second, client-side read; the
 * ranking of four bracket teams does not depend on them.
 *
 * A League takes individual Tournaments only (rulings 729, 981): linking this one is refused with
 * a 409 that names `team_tournament_league`, and no link is written.
 *
 * Builds its own `club` Event, as `15-public-site.spec.ts` does and for the same reasons: the
 * public site shows no test Event, and publishing a `standard` Event announces it to the
 * organisation's followers. A `club` Event is public, silent on publish and hard-deletable.
 */
const TEAM_TOURNAMENT = ['1', 'true', 'yes'].includes(
  (process.env.E2E_TEAM_TOURNAMENT ?? '').toLowerCase(),
);
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

/** The deployed web-public host, as in `15-public-site.spec.ts`. */
const publicBase = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(/\/$/, '');

let createdEventId: string | null = null;
let createdLeagueId: string | null = null;

test.describe('team tournament', () => {
  test.skip(
    !TEAM_TOURNAMENT,
    'set E2E_TEAM_TOURNAMENT=1 to play a team Tournament to its champion',
  );

  test('a team tournament runs from its pool to a champion and its public final ranking', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);

    // ── A public Event of this spec's own ──────────────────────────────────
    const eventSlug = `e2e-teams-${token}`;
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) teams — ${token}`,
          slug: eventSlug,
          startDate: '2099-03-01',
          endDate: '2099-03-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'club',
        },
      }),
    );
    createdEventId = event.id;

    const tournament: TeamTournament = await createTeamPoolTournament(api, event.id, {
      name: `Team Cup ${token}`,
      slug: `team-cup-${token}`,
      poolCount: 1,
    });
    const teamIds = tournament.teams.map((team) => team.id);
    // Published before any bout: only an open Tournament completes by itself.
    await publishTournamentAndEvent(api, event.id, tournament.id);

    // ── The Pool: a round robin of four teams, six bouts ───────────────────
    expect(await readTeamPoolBouts(api, tournament.id)).toHaveLength(6);
    await playTeamPools(api, tournament);
    const poolBouts = await readTeamPoolBouts(api, tournament.id);
    expect(poolBouts.filter((bout) => bout.status !== 'completed')).toEqual([]);
    expect(poolBouts.filter((bout) => !bout.winner_team_id)).toEqual([]);

    const standings = await poll(
      () => readOverallStandings(api, tournament.id),
      (rows) => rows.length === 4,
      'the Pool standings list the four teams',
    );
    expect(standings.map((row) => row.entrantId)).toEqual(teamIds);

    // ── The bracket of four, seeded from the Pool ──────────────────────────
    const drawn = await generateTeamBracket(api, tournament.id, 4);
    const semiFinals = drawn
      .filter((slot) => slot.round === 1)
      .map((slot) => [slot.redSideId, slot.blueSideId].sort());
    expect(semiFinals.sort()).toEqual(
      [[teamIds[0], teamIds[3]].sort(), [teamIds[1], teamIds[2]].sort()].sort(),
    );
    // A team side names no Registration.
    expect(drawn.filter((slot) => slot.redRegistrationId || slot.blueRegistrationId)).toEqual([]);

    const played = await playTeamBracket(api, tournament);
    expect(played.filter((slot) => slot.status !== 'completed')).toEqual([]);
    const finalBout = played.find((slot) => slot.round === 2 && slot.position === 1);
    const bronzeBout = played.find((slot) => slot.round === 2 && slot.position === 2);
    expect(bronzeBout?.source_a_ref, 'position 2 of the last round is the bronze bout').toMatch(
      /^loser of /,
    );
    expect(finalBout?.winnerSideId, 'the champion is seed 1').toBe(teamIds[0]);
    expect(bronzeBout?.winnerSideId, 'the bronze goes to seed 3').toBe(teamIds[2]);

    await poll(
      async () =>
        (await api.json<{ status: string }>(await api.get(`tournaments/${tournament.id}`))).status,
      (status) => status === 'completed',
      'the team Tournament completes once its bracket has a champion',
    );

    // ── The public final ranking ───────────────────────────────────────────
    await page.goto(`${publicBase}/e/${eventSlug}/t/${tournament.slug}#finalranking`, {
      waitUntil: 'domcontentloaded',
    });
    const rows = page.locator('#panel-finalranking tbody tr');
    await expect(rows).toHaveCount(4, { timeout: 30_000 });
    for (const [index, team] of tournament.teams.entries()) {
      await expect(rows.nth(index).locator('td').first()).toContainText(String(index + 1));
      await expect(rows.nth(index)).toContainText(team.name);
    }
    await expect(rows.first()).toContainText('🥇');

    // ── A League refuses a team Tournament ─────────────────────────────────
    const league = await api.json<{ id: string }>(
      await api.post('admin/leagues', {
        data: {
          name: `E2E TEST (auto) team league — ${token}`,
          slug: `team-league-${token}`,
          seasonYear: 2098,
          ownerOrganizationId: orgId,
        },
      }),
    );
    createdLeagueId = league.id;
    const refused = await api.post(`admin/leagues/${league.id}/tournaments/${tournament.id}/link`, {
      data: {},
    });
    expect(refused.status()).toBe(409);
    const body = (await refused.json()) as { details?: { reason?: string } };
    expect(body.details?.reason).toBe('team_tournament_league');
    expect(
      await api.json<unknown[]>(await api.get(`admin/leagues/${league.id}/tournament-links`)),
      'a refused link writes nothing',
    ).toEqual([]);
  });

  /**
   * Nothing this spec created stays public: the League is deleted, and the Event is hard-deleted
   * with `E2E_CLEANUP`, else flipped to `test` kind (the public resolver gates on kind), as `15`
   * does.
   */
  test.afterAll(async ({ playwright }) => {
    const { baseURL } = runContext();
    const ctx = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    if (createdLeagueId) {
      const res = await ctx.delete(`/api/v1/admin/leagues/${createdLeagueId}`);
      if (!res.ok())
        console.warn(`[e2e] could not delete league ${createdLeagueId}: ${res.status()}`);
    }
    if (createdEventId) {
      const res = CLEANUP
        ? await ctx.delete(`/api/v1/events/${createdEventId}?mode=hard`)
        : await ctx.patch(`/api/v1/events/${createdEventId}`, { data: { eventKind: 'test' } });
      if (!res.ok()) {
        console.warn(
          `[e2e] could not ${CLEANUP ? 'delete' : 'hide'} team event ${createdEventId}: ${res.status()}`,
        );
      }
    }
    await ctx.dispose();
  });
});
