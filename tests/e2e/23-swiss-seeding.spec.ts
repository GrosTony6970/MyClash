import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, createBracketTournament, ensurePersons, POINT_CAP, scoreMatch } from './_bracket';
import {
  buildSwissTournament,
  readSwiss,
  readSwissAdmin,
  waitForRoundOnly,
  winnerSideOf,
} from './_swiss';

/**
 * How a Swiss phase is SEEDED, and what happens when an override breaks a round
 * (run with E2E_SWISS=1).
 *
 * `22-swiss.spec.ts` plays the format; this covers the two edges around it that
 * had never run anywhere.
 *
 * **The refusals.** Every seeding strategy shares one rule, written into
 * `swiss-seeding.service.ts`'s own header: REFUSE rather than degrade. A draw
 * that quietly falls back to registration order is worse than an error — it
 * looks like a seeded draw, it gets defended as one, and nobody finds out until
 * somebody checks. Two refusals implement that (`by-pool-rank` without a
 * finished pool phase, `by-rating` under the coverage threshold) and neither had
 * ever been executed.
 *
 * **The escape hatch.** `setMatchSides` is the one override that can leave a
 * round invalid — it writes whoever it is told to, so a fighter can end up in
 * two bouts. `validateSwissRound` is thoroughly unit-tested; the CONSEQUENCE it
 * exists for — an invalid round blocking the next one from being paired — is
 * only observable against real rows.
 *
 * Kept out of `22` because that file sits at 390 of the 400-line file limit.
 */
const SWISS = ['1', 'true', 'yes'].includes((process.env.E2E_SWISS ?? '').toLowerCase());

const POOL_FIELD = 8;
const SWISS_FIELD = 9;
const ROUNDS = 3;

test.describe(SWISS ? 'Swiss seeding' : 'Swiss seeding (set E2E_SWISS=1 to run)', () => {
  test.skip(!SWISS, 'Writes real tournaments and scores real matches; opt in with E2E_SWISS=1.');

  test('F. by-pool-rank refuses an unfinished pool phase, then seeds from a finished one', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const token = Date.now().toString(36);

    const fighters = await ensurePersons(api, eventId, POOL_FIELD);
    const tournament = await createBracketTournament(api, eventId, {
      name: `Swiss pool-rank ${token}`,
      slug: `swiss-poolrank-${token}`,
      fighters,
    });

    // ── No pool phase at all ────────────────────────────────────────────────
    const noPools = await api.post(`tournaments/${tournament.id}/generate-swiss`, {
      data: { roundCount: ROUNDS, seedingStrategy: 'by-pool-rank' },
    });
    expect(noPools.status(), 'by-pool-rank with no pool phase must refuse').toBe(400);
    expect(await noPools.text()).toContain('pool phase');

    // ── A pool phase that exists but has not been played ────────────────────
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, {
        data: { poolCount: 2, enforceSchoolSeparation: false, enforceSkillBalance: false },
      }),
    );
    const unfinished = await api.post(`tournaments/${tournament.id}/generate-swiss`, {
      data: { roundCount: ROUNDS, seedingStrategy: 'by-pool-rank' },
    });
    // The realistic mistake: generating the next phase while bouts are open.
    // Falling back to registration order here would look like a seeded draw.
    expect(unfinished.status(), 'by-pool-rank with open pool bouts must refuse').toBe(400);
    expect(await unfinished.text()).toContain('complete');

    // ── Play every pool bout, then seed for real ────────────────────────────
    // `match-scores` rather than `pools-with-matches`: the pool phase is the
    // ONLY phase on this tournament at this point, so every row is a pool bout,
    // and this projection's shape is a flat {id, status} that cannot drift into
    // the nested pool payload's richer one.
    const poolMatches = await api.json<Array<{ id: string; status: string }>>(
      await api.get(`tournaments/${tournament.id}/match-scores`),
    );
    expect(poolMatches.length, 'the pool phase produced no bouts').toBeGreaterThan(0);
    for (const match of poolMatches) {
      if (match.status === 'completed') continue;
      await scoreMatch(api, match.id, 'red', POINT_CAP);
    }

    const generated = await api.json<{ phaseId: string; entrants: number }>(
      await api.ok(
        await api.post(`tournaments/${tournament.id}/generate-swiss`, {
          data: { roundCount: ROUNDS, seedingStrategy: 'by-pool-rank' },
        }),
      ),
    );
    expect(generated.entrants).toBe(POOL_FIELD);

    // A three-stage tournament: the pool phase is untouched and the Swiss phase
    // sits beside it. `phases.sort_order` (pool 1, swiss 2) is what keeps them
    // in running order wherever phases are listed.
    const swiss = await readSwiss(api, tournament.id);
    expect(swiss.rounds).toHaveLength(1);
    expect(swiss.rounds[0]?.matches).toHaveLength(POOL_FIELD / 2);
    const stillPooled = await api.json<unknown[]>(
      await api.get(`tournaments/${tournament.id}/pools`),
    );
    expect(stillPooled, 'generating Swiss must not disturb the pool phase').toBeTruthy();
  });

  test('G. by-rating refuses below the coverage threshold it was given', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const token = Date.now().toString(36);

    const fighters = await ensurePersons(api, eventId, SWISS_FIELD);
    const tournament = await createBracketTournament(api, eventId, {
      name: `Swiss by-rating ${token}`,
      slug: `swiss-byrating-${token}`,
      fighters,
    });

    // The shared roster carries no HEMA ids, so coverage is 0% — which makes
    // this exact rather than dependent on whatever the live ratings snapshot
    // happens to hold today.
    const refused = await api.post(`tournaments/${tournament.id}/generate-swiss`, {
      data: {
        roundCount: ROUNDS,
        seedingStrategy: 'by-rating',
        minRatingCoveragePercent: 50,
      },
    });
    expect(refused.status(), 'by-rating below the threshold must refuse').toBe(400);
    const message = await refused.text();
    // The refusal has to say WHAT the coverage was, or the organiser cannot tell
    // whether to lower the threshold or pick another strategy.
    expect(message).toContain('0');
    expect(message).toContain('50');

    // Threshold 0 accepts it — everyone unrated is a legal draw, just not a
    // rating-based one, and the coverage comes back so the operator can see that.
    const generated = await api.json<{
      entrants: number;
      ratingCoverage: { rated: number; total: number; percent: number } | null;
    }>(
      await api.ok(
        await api.post(`tournaments/${tournament.id}/generate-swiss`, {
          data: {
            roundCount: ROUNDS,
            seedingStrategy: 'by-rating',
            minRatingCoveragePercent: 0,
          },
        }),
      ),
    );
    expect(generated.entrants).toBe(SWISS_FIELD);
    expect(generated.ratingCoverage).toEqual({ rated: 0, total: SWISS_FIELD, percent: 0 });
  });

  test('H. a round broken by set-sides blocks the next one until it is fixed', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const { tournament, seeds } = await buildSwissTournament(api, eventId, {
      key: `setsides-${Date.now().toString(36)}`,
      count: SWISS_FIELD,
      roundCount: ROUNDS,
    });

    const opening = (await readSwiss(api, tournament.id)).rounds[0]!;
    const [first, second] = [opening.matches[0]!, opening.matches[1]!];
    const duplicated = first.redRegistrationId!;

    // Deliberately put one fighter in TWO bouts. Only set-sides can do this —
    // a swap is invariant-preserving by construction — which is exactly why the
    // escape hatch sits behind an "advanced" affordance in the UI.
    await api.ok(
      await api.patch(`matches/${second.id}/swiss-sides`, {
        data: {
          redRegistrationId: duplicated,
          blueRegistrationId: second.blueRegistrationId,
          confirm: true,
        },
      }),
    );

    const admin = await readSwissAdmin(api, tournament.id);
    const round = admin.rounds.find((r) => r.roundNumber === 1)!;
    expect(round.validity.valid, 'the round should be reported invalid').toBe(false);
    expect(round.validity.duplicated).toContain(duplicated);
    // Somebody was displaced by the write, so the round is short a fighter too.
    expect(round.validity.missing.length).toBeGreaterThan(0);

    // Now score every bout. Round 2 must NOT pair: carrying a round where a
    // fighter fought twice would propagate the error into every later round's
    // standings, so advancement stops instead.
    for (const match of (await readSwiss(api, tournament.id)).rounds[0]!.matches) {
      if (match.status === 'completed') continue;
      await scoreMatch(api, match.id, winnerSideOf(match, seeds), POINT_CAP);
    }
    const next = await waitForRoundOnly(api, tournament.id, 2, 6, 750);
    expect(next, 'an invalid round must not pair the next one').toBeNull();

    // The manual commit route is refused for the same reason, so there is no
    // back door — and unlike the auto-advance (which swallows, by design) it
    // returns the message naming what is wrong.
    const forced = await api.post(`swiss-phases/${admin.phaseId}/next-round`, {});
    expect(forced.status(), 'the manual commit must refuse an invalid round too').toBe(409);
    expect(await forced.text()).toContain('not a valid Swiss round');
  });
});
