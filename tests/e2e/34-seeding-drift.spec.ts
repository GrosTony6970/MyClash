import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';
import {
  ensureRoster,
  nextExchangeSequence,
  readBracket,
  scoreMatch,
  POINT_CAP,
  type Bracket,
} from './_bracket';
import {
  createPoolTournament,
  playPoolPhase,
  poll,
  poolDecider,
  rankOf,
  readOverallStandings,
  readPoolStandings,
  resetMatch,
} from './_pool';

/**
 * Walk a bracket through all four seeding-drift states, for real.
 *
 * `seedingDrift` makes a claim a unit test cannot check: that the plan it
 * recomputes on a READ is the plan `populateBracket` would actually WRITE. The
 * unit tests mock the standings service, so they prove the wiring and the state
 * machine; whether the two code paths agree is only observable against real pool
 * results, a real draw and a real re-populate.
 *
 * The walk is the feature. Reopening a pool bout is not an error state — it is a
 * bracket about to heal itself (`pending`). It only becomes a problem once an R1
 * bout has started, because the auto-populate that would have re-seeded is then
 * refused, silently, which is the whole reason the banner exists.
 *
 *     fresh → start an R1 bout        → fresh, but now blocked
 *           → reopen a pool bout      → pending
 *           → replay it, other winner → stale
 *           → reset the R1 bout       → stale, unblocked
 *           → populate                → fresh, slots ACTUALLY moved
 *
 * The last step is what makes the rest mean anything: drift said the draw
 * disagreed with the standings, and re-seeding moved exactly the slots it named.
 * Without it, every earlier assertion only proves the endpoint agrees with
 * itself.
 */
const DRIFT = ['1', 'true', 'yes'].includes((process.env.E2E_DRIFT ?? '').toLowerCase());

const FIELD = 8;
const POOL_COUNT = 2;

/** Every SEEDED R1 side, keyed `slotId:red` / `slotId:blue`. The draw, flattened. */
type Seeding = Map<string, string | null>;

const title = DRIFT ? 'bracket seeding drift' : 'bracket seeding drift (set E2E_DRIFT=1 to run)';

test.describe(title, () => {
  test.skip(!DRIFT, 'Builds a pool tournament and scores real matches; opt in with E2E_DRIFT=1.');

  test('a reopened pool result drives the bracket through pending → stale → fresh', async ({
    request,
    page,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { orgSlug, eventId } = runContext();
    const token = Date.now().toString(36);

    // ── A played pool phase, seeded straight down ──────────────────────────
    // The lower seed wins every bout, so each pool ranks in seed order and
    // everything below can name exactly who should be where.
    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: FIELD }, (_, i) => ({
        givenName: 'Drift',
        familyName: String(i + 1).padStart(2, '0'),
      })),
    );
    const tournament = await createPoolTournament(api, eventId, {
      name: `Seeding drift ${token}`,
      slug: `seeding-drift-${token}`,
      fighters,
      poolCount: POOL_COUNT,
    });
    await playPoolPhase(api, tournament);

    const pools = await readPoolStandings(api, tournament.id);
    expect(pools).toHaveLength(POOL_COUNT);
    expect(
      pools.filter((p) => p.status !== 'completed'),
      'every pool must be complete before the bracket is seeded',
    ).toEqual([]);

    const standingsBefore = await readOverallStandings(api, tournament.id);
    expect(standingsBefore, 'the pool phase produced no standings').toHaveLength(FIELD);

    // ── Seed the bracket from those standings ──────────────────────────────
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-bracket`, {
        data: { phaseType: 'single_elim', qualifyCount: FIELD },
      }),
    );
    // Called explicitly even though completing the last pool bout fires an
    // auto-populate: that hook is fire-and-forget, and this spec needs a known
    // starting point rather than a race with it.
    await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

    const fresh = await readBracket(api, tournament.id);
    expect(fresh.seedingDrift, 'this deploy does not report seedingDrift').toBeDefined();
    expect(fresh.seedingDrift).toEqual({
      state: 'fresh',
      source: 'pool-standings',
      changedSlotIds: [],
      blockingMatchIds: [],
    });
    const seedingBefore = r1Seeding(fresh);
    expect(seedingBefore.size, 'the draw seeded no R1 sides').toBeGreaterThan(0);

    // ── Start one R1 bout. Nothing drifts — but a re-seed is now blocked ────
    const startedSlot = fresh.slots.find((s) => s.round === 1 && s.matchId);
    expect(startedSlot, 'the bracket has no playable R1 bout').toBeTruthy();
    const startedMatchId = startedSlot!.matchId as string;
    await api.ok(await api.post(`matches/${startedMatchId}/clock`, { data: { action: 'start' } }));

    const blocked = await readBracket(api, tournament.id);
    expect(
      blocked.seedingDrift?.state,
      'starting a bout changes no standings, so nothing has drifted yet',
    ).toBe('fresh');
    expect(
      blocked.seedingDrift?.blockingMatchIds,
      'the started bout is what a later re-seed will be refused over',
    ).toEqual([startedMatchId]);

    // ── Reopen the bout that decides a pool's top two ──────────────────────
    // Putting it back in play re-opens the pool gate. That is `pending`: the
    // source is no longer final, and the bracket would re-seed itself the
    // moment the bout is played again.
    const decider = await poolDecider(api, tournament);
    expect(
      rankOf(standingsBefore, decider.leaderId),
      'the fixture assumes the pool leader outranks their runner-up overall too',
    ).toBeLessThan(rankOf(standingsBefore, decider.runnerUpId));

    await resetMatch(api, decider.matchId, 'e2e seeding drift');

    const pending = await poll(
      () => readBracket(api, tournament.id),
      (b) => b.seedingDrift?.state === 'pending',
      'reopening a pool bout must report pending',
    );
    expect(
      pending.seedingDrift?.changedSlotIds,
      'pending means "no plan to compare yet", never "these slots are wrong"',
    ).toEqual([]);
    expect(pending.seedingDrift?.source).toBe('pool-standings');

    // ── Replay it the other way. The standings move; the bracket cannot ────
    // Completing the last open pool bout fires the auto-populate, which is
    // REFUSED because an R1 bout has started. That refusal is silent, and the
    // bracket is left seeded from standings that no longer exist.
    // From a fresh sequence: the reset VOIDED the first playthrough's exchanges
    // rather than deleting them, and `UNIQUE(match_id, sequence)` still covers
    // them, so replaying from 1 collides with the bout's own history.
    await scoreMatch(
      api,
      decider.matchId,
      decider.runnerUpColor,
      POINT_CAP,
      await nextExchangeSequence(api, decider.matchId),
    );

    const standingsAfter = await poll(
      () => readOverallStandings(api, tournament.id),
      (rows) =>
        rows.length === FIELD && rankOf(rows, decider.runnerUpId) < rankOf(rows, decider.leaderId),
      'flipping a head-to-head must swap those two in the overall standings',
    );
    expect(
      rankOf(standingsAfter, decider.runnerUpId),
      'the fixture no longer creates drift — the flip must reorder the standings',
    ).toBeLessThan(rankOf(standingsAfter, decider.leaderId));

    const stale = await poll(
      () => readBracket(api, tournament.id),
      (b) => b.seedingDrift?.state === 'stale',
      'a changed pool result with a started R1 bout must report stale',
    );
    expect(
      stale.seedingDrift?.changedSlotIds.length,
      'stale must name the slots that no longer match',
    ).toBeGreaterThan(0);
    expect(stale.seedingDrift?.blockingMatchIds).toEqual([startedMatchId]);
    // Nothing re-seeded itself — the draw is exactly as it was.
    expect(r1Seeding(stale), 'a refused re-seed must leave the draw alone').toEqual(seedingBefore);

    // ── The banner, on the page an organiser is actually looking at ────────
    await expectDriftBanner(
      page,
      `/org/${orgSlug}/events/${eventId}/bracket?tournamentId=${tournament.id}`,
    );

    // ── The cheap remedy the banner names, taken for real ──────────────────
    // Putting the started bout back is all that stands between here and a
    // healthy bracket. Regenerate would have deleted every bout already fought.
    await resetMatch(api, startedMatchId, 'e2e seeding drift — unblock the re-seed');
    const unblocked = await readBracket(api, tournament.id);
    expect(unblocked.seedingDrift?.blockingMatchIds, 'the block is gone').toEqual([]);
    expect(
      unblocked.seedingDrift?.state,
      'unblocking does not itself re-seed — the draw is still stale',
    ).toBe('stale');

    // ── Re-seed, and prove drift was describing something real ─────────────
    await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));
    const healed = await readBracket(api, tournament.id);
    expect(healed.seedingDrift?.state, 'a re-seeded bracket is fresh again').toBe('fresh');
    expect(healed.seedingDrift?.changedSlotIds).toEqual([]);

    const moved = [...r1Seeding(healed)].filter(([side, reg]) => seedingBefore.get(side) !== reg);
    expect(
      moved.length,
      'drift claimed the draw disagreed with the standings, so re-seeding must move something',
    ).toBeGreaterThan(0);
    // And exactly the slots it named. `changedSlotIds` is a promise about WHICH
    // slots would move, not a vague "something is off".
    expect(new Set(moved.map(([side]) => side.split(':')[0]))).toEqual(
      new Set(stale.seedingDrift?.changedSlotIds ?? []),
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Both sides of every seeded R1 slot.
 *
 * Only sides the generator labelled `seed N` count. A play-in bracket's R1 side
 * B is filled by ADVANCEMENT, not by seeding, and comparing it would report a
 * change the draw never made — the same trap `diffR1SeedingPlan` skips
 * server-side. This field is a power of two, so there is no round 0 here at all.
 */
function r1Seeding(bracket: Bracket): Seeding {
  const isSeedRef = (ref: string | null): boolean => /^seed \d+$/.test(ref ?? '');
  const seeding: Seeding = new Map();
  for (const slot of bracket.slots) {
    if (slot.round !== 1) continue;
    if (isSeedRef(slot.source_a_ref)) seeding.set(`${slot.id}:red`, slot.redRegistrationId);
    if (isSeedRef(slot.source_b_ref)) seeding.set(`${slot.id}:blue`, slot.blueRegistrationId);
  }
  return seeding;
}

/**
 * The drift banner on the bracket page, asserted by KIND rather than by copy.
 *
 * Every label on this page exists in English and French, so a text assertion
 * would really be asserting on whichever language the session happens to be in
 * (`09-double-elim.spec.ts` sidesteps the same problem by asserting on fighter
 * names). `data-remedy` carries the one thing that must hold: the cheap fix is
 * offered BEFORE the one that deletes every bout already fought.
 */
async function expectDriftBanner(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const banner = page.getByTestId('seeding-drift');
  await expect(banner, 'a stale bracket must warn on the page').toBeVisible();
  await expect(banner).toHaveAttribute('data-drift-state', 'stale');

  const remedies = banner.getByTestId('seeding-drift-remedy');
  await expect(remedies).toHaveCount(2);
  expect(
    await remedies.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-remedy'))),
    'the cheap remedy must be named before Regenerate',
  ).toEqual(['reset', 'regenerate']);
}
