import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { POINT_CAP, scoreMatch } from './_bracket';

/**
 * Referee compensation, end to end (run with E2E_COMPENSATION=1).
 *
 * This is the one surface in MyClash that produces a number somebody is PAID.
 * It is also derived through four hops that no test had ever run together:
 * assignment → completed matches in that scope → tokens at the plan's rate →
 * a tier band → clamped to the event's floor and cap. Every hop is unit-tested
 * in isolation over hand-built rows; the composition was not.
 *
 * The payment round-trip found the fourth bug of this spec family: the report
 * emitted one id and the payments table keyed on another, so marking an
 * UNCLAIMED referee paid — nearly every referee at a real event — wrote a row
 * nothing could read back, while the UI flipped the checkbox optimistically and
 * reverted on the next reload. Fixed by migration 0163; these assertions are
 * what hold it.
 *
 * The setup is chosen so the expected payout is knowable in advance rather than
 * read back and re-asserted: a 4-fighter round-robin pool has exactly SIX
 * matches, the spec plays exactly FOUR of them, and one referee is assigned to
 * that pool at a known rate. Four completed matches at three tokens each is
 * twelve tokens, and twelve tokens lands in a band worth a known amount. The
 * two unplayed matches are the control: a payout that counts SCHEDULED matches
 * reads eighteen tokens and lands in a different band.
 *
 * The referee is an ordinary unclaimed roster person on purpose. That is the
 * common case in the field, and it is the case the payment round-trip used to
 * lose silently.
 */
const COMPENSATION = ['1', 'true', 'yes'].includes(
  (process.env.E2E_COMPENSATION ?? '').toLowerCase(),
);

/** 4 fighters → a 6-match round robin (`bergerSchedule`). */
const POOL_FIGHTERS = 4;
const POOL_MATCHES = 6;
/** Played to completion. The rest stay `scheduled` and must earn nothing. */
const PLAYED_MATCHES = 4;

/** The system referee skill the assignment and the rate both key on. */
const ROLE = 'arbitre_declarant';

const TOKENS_PER_POOL_MATCH = 3;
const EXPECTED_TOKENS = PLAYED_MATCHES * TOKENS_PER_POOL_MATCH; // 12

/**
 * Bands wide enough that both the right answer and the two obvious wrong ones
 * (counting every scheduled match, or counting none) land somewhere different.
 */
const TIERS = [
  { minTokens: 0, maxTokens: 9, amount: 10 },
  { minTokens: 10, maxTokens: 17, amount: 40 },
  { minTokens: 18, maxTokens: null, amount: 100 },
];
const EXPECTED_TIER_AMOUNT = 40;

/** Floor above / cap below the tier amount, so each clamp is observable. */
const FLOOR = 60;
const CAP = 25;

// ── API shapes ───────────────────────────────────────────────────────────────

interface BreakdownLine {
  phase: string;
  role: string;
  matchCount: number;
  tokensPerMatch: number;
  subtotal: number;
}

interface RefereeLine {
  userId: string;
  displayName: string;
  totalTokens: number;
  amountOwed: number;
  paid: boolean;
  paidAt: string | null;
  breakdown: BreakdownLine[];
}

interface Report {
  planId: string;
  planName: string;
  maxCap: number | null;
  minFloor: number | null;
  referees: RefereeLine[];
  grandTotal: number;
}

interface PoolWithMatches {
  poolId: string;
  matches: Array<{ id: string; status: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const report = async (api: Api, eventId: string) =>
  api.json<Report>(await api.get(`events/${eventId}/compensation/report`));

/** This spec's referee line, found by the user id the report attributes to it. */
function lineFor(payload: Report, userId: string): RefereeLine {
  const line = payload.referees.find((r) => r.userId === userId);
  expect(
    line,
    `no compensation line for ${userId}; report had ${payload.referees.map((r) => r.userId).join(', ') || '(nobody)'}`,
  ).toBeDefined();
  return line!;
}

/** Point the event's compensation settings at a plan, with an optional band. */
const setSettings = async (
  api: Api,
  eventId: string,
  planId: string,
  bounds: { minCompensationAmount?: number | null; maxCompensationAmount?: number | null } = {},
) =>
  api.ok(
    await api.put(`events/${eventId}/compensation/settings`, {
      data: {
        planId,
        minCompensationAmount: bounds.minCompensationAmount ?? null,
        maxCompensationAmount: bounds.maxCompensationAmount ?? null,
      },
    }),
  );

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('compensation', () => {
  test.skip(!COMPENSATION, 'set E2E_COMPENSATION=1 to compute a real referee payout');

  test('a referee is paid for the matches they actually worked', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId, orgId } = runContext();
    const token = Date.now().toString(36);

    // ── The referee ────────────────────────────────────────────────────────
    // An ordinary roster person, which is what a referee at a real event
    // almost always is: someone the organiser typed in, with no MyClash
    // account behind them.
    const refereePerson = await api.json<{ id: string; globalPersonId: string }>(
      await api.post(`events/${eventId}/persons`, {
        data: { givenName: 'Comp', familyName: `Ref ${token}` },
      }),
    );
    const globalPersonId = refereePerson.globalPersonId;
    expect(globalPersonId, 'every person gets a global identity on create').toBeTruthy();
    await api.ok(await api.post(`events/${eventId}/referees/${refereePerson.id}`));
    await api.ok(
      await api.put(`events/${eventId}/referee-qualifications`, {
        data: { personId: globalPersonId, role: ROLE, rating: 4 },
      }),
    );

    // ── A pool with a knowable number of matches ───────────────────────────
    const tournament = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/tournaments`, {
        data: {
          name: `Compensation ${token}`,
          slug: `comp-${token}`,
          weapon: 'longsword',
          color: 'blue',
        },
      }),
    );
    // Pin the point cap so `scoreMatch` ends each match; the default of 10 would
    // leave every one of them running.
    await api.ok(
      await api.patch(`tournaments/${tournament.id}`, {
        data: { rulesetConfig: { matchFormat: { pointCap: POINT_CAP } } },
      }),
    );

    for (let index = 0; index < POOL_FIGHTERS; index++) {
      const person = await api.json<{ id: string }>(
        await api.post(`events/${eventId}/persons`, {
          data: { givenName: 'CompFighter', familyName: `${token}-${index}` },
        }),
      );
      await api.ok(
        await api.post(`tournaments/${tournament.id}/registrations`, {
          data: { personId: person.id, seed: index + 1 },
        }),
      );
    }
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
    );

    const pools = await api.json<PoolWithMatches[]>(
      await api.get(`tournaments/${tournament.id}/pools-with-matches`),
    );
    expect(pools).toHaveLength(1);
    const pool = pools[0]!;
    expect(pool.matches, 'a 4-fighter round robin is 6 matches').toHaveLength(POOL_MATCHES);

    // ── Assign the referee to the pool ─────────────────────────────────────
    await api.ok(
      await api.post(`events/${eventId}/referee-assignments`, {
        data: { poolId: pool.poolId, role: ROLE, personId: globalPersonId },
      }),
    );

    // ── The plan: a rate for the phase worked, and two that are not ────────
    const plan = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/compensation-plans`, {
        data: { name: `E2E TEST (auto) plan ${token}`, description: 'E2E compensation spec' },
      }),
    );
    await api.ok(
      await api.put(`compensation-plans/${plan.id}/role-rates`, {
        data: {
          rates: [
            { refereeRole: ROLE, compensationPhase: 'pool', tokensPerMatch: TOKENS_PER_POOL_MATCH },
            // Deliberately extravagant, and deliberately unreachable: this
            // referee worked a pool, so a bracket or finals line appearing in
            // the breakdown would mean the phase split invented work.
            { refereeRole: ROLE, compensationPhase: 'bracket', tokensPerMatch: 50 },
            { refereeRole: ROLE, compensationPhase: 'finals', tokensPerMatch: 50 },
          ],
        },
      }),
    );
    await api.ok(await api.put(`compensation-plans/${plan.id}/tiers`, { data: { tiers: TIERS } }));
    await setSettings(api, eventId, plan.id);

    // ── Nothing played yet: no tokens, and no line at all ──────────────────
    // Every match is `scheduled`, and the accumulator only records a scope that
    // produced completed matches — so the referee has not earned a floor either.
    const beforePlay = await report(api, eventId);
    expect(beforePlay.planId).toBe(plan.id);
    expect(beforePlay.referees.map((r) => r.userId)).not.toContain(globalPersonId);

    // ── Play four of the six ───────────────────────────────────────────────
    for (const match of pool.matches.slice(0, PLAYED_MATCHES)) {
      await scoreMatch(api, match.id, 'red');
    }
    const afterPlay = await api.json<PoolWithMatches[]>(
      await api.get(`tournaments/${tournament.id}/pools-with-matches`),
    );
    expect(
      afterPlay[0]!.matches.filter((m) => m.status === 'completed'),
      'exactly the matches this spec played are completed',
    ).toHaveLength(PLAYED_MATCHES);

    // ── The payout ─────────────────────────────────────────────────────────
    const earned = lineFor(await report(api, eventId), globalPersonId);
    expect(earned.totalTokens).toBe(EXPECTED_TOKENS);
    expect(earned.amountOwed).toBe(EXPECTED_TIER_AMOUNT);
    expect(earned.paid).toBe(false);
    expect(earned.paidAt).toBeNull();

    // One line, for the phase actually worked, counting only completed matches.
    expect(earned.breakdown).toHaveLength(1);
    expect(earned.breakdown[0]).toMatchObject({
      phase: 'pool',
      role: ROLE,
      matchCount: PLAYED_MATCHES,
      tokensPerMatch: TOKENS_PER_POOL_MATCH,
      subtotal: EXPECTED_TOKENS,
    });

    // ── The floor and the cap ──────────────────────────────────────────────
    await setSettings(api, eventId, plan.id, { minCompensationAmount: FLOOR });
    const floored = await report(api, eventId);
    expect(floored.minFloor).toBe(FLOOR);
    expect(lineFor(floored, globalPersonId).amountOwed, 'the floor lifts a small payout').toBe(
      FLOOR,
    );

    await setSettings(api, eventId, plan.id, { maxCompensationAmount: CAP });
    const capped = await report(api, eventId);
    expect(capped.maxCap).toBe(CAP);
    expect(lineFor(capped, globalPersonId).amountOwed, 'the cap trims a large payout').toBe(CAP);

    // Both at once, with the floor ABOVE the cap: the floor wins. That is the
    // documented order (`clampCompensationAmount` applies the floor last), and
    // it is the case an organiser reaches by mistake — a minimum they promised
    // and a budget cap they set lower.
    await setSettings(api, eventId, plan.id, {
      minCompensationAmount: FLOOR,
      maxCompensationAmount: CAP,
    });
    const both = await report(api, eventId);
    expect(lineFor(both, globalPersonId).amountOwed, 'floor is applied after cap').toBe(FLOOR);

    // The grand total is the sum of the lines it reports — other specs share
    // this event, so the aggregate is checked for consistency, not for a value.
    expect(both.grandTotal).toBe(both.referees.reduce((sum, r) => sum + r.amountOwed, 0));

    // ── Marking it paid ────────────────────────────────────────────────────
    await setSettings(api, eventId, plan.id);
    await api.ok(
      await api.patch(`events/${eventId}/compensation/payments/${globalPersonId}`, {
        data: { paid: true },
      }),
    );
    const afterPaid = lineFor(await report(api, eventId), globalPersonId);
    expect(afterPaid.paid).toBe(true);
    expect(afterPaid.paidAt).not.toBeNull();
    // Marking someone paid must not change what they are owed.
    expect(afterPaid.amountOwed).toBe(EXPECTED_TIER_AMOUNT);

    await api.ok(
      await api.patch(`events/${eventId}/compensation/payments/${globalPersonId}`, {
        data: { paid: false },
      }),
    );
    const afterUnpaid = lineFor(await report(api, eventId), globalPersonId);
    expect(afterUnpaid.paid).toBe(false);
    expect(afterUnpaid.paidAt).toBeNull();

    // ── Cleanup ────────────────────────────────────────────────────────────
    // The plan belongs to the org, not the event, so teardown would leave it
    // behind. Deleting it also detaches the event settings row.
    const deleted = await api.delete(`compensation-plans/${plan.id}`);
    if (!deleted.ok()) {
      console.warn(`[e2e] could not delete compensation plan ${plan.id}: ${deleted.status()}`);
    }
  });
});
