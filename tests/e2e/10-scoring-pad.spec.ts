import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensurePersons, type Person } from './_bracket';

/**
 * The scoring pad's server contract, end to end against a real database.
 *
 * The pad is the app used live at an event, under time pressure, by someone who
 * cannot debug it — and it had almost no end-to-end coverage. Of its 22
 * endpoints the suite touched exactly one: `POST exchanges`, and only to prove
 * the offline outbox drains (`06`/`08`, which keep that job). Nothing covered
 * the clock state machine, the exchange types, undo, or how a match actually
 * finishes.
 *
 * That gap is what let a whole bug family survive: the pad never calls
 * `PATCH /matches/:id/status`, so every completion side effect wired only to
 * that endpoint was dead for real users while the tests stayed green. Driving
 * the pad's OWN endpoints is the point.
 *
 * API-driven by choice. The browser work that genuinely needs a client — the
 * IndexedDB outbox and reconnect sync — already has `06`/`08`; what is missing
 * is exact, fast assertions on the server contract underneath.
 *
 * The invariant threaded through every case is AGENTS.md rule #1: **score is
 * derived from exchanges, never stored as the source of truth**. Each case
 * asserts the persisted `red_score`/`blue_score` equal what the ruleset engine
 * should have derived. Without that the rest would only prove endpoints return
 * 200.
 */
const SCORING_PAD = ['1', 'true', 'yes'].includes(
  (process.env.E2E_SCORING_PAD ?? '').toLowerCase(),
);

/** Low cap so a match completes in few exchanges; also a realistic HEMA value. */
const POINT_CAP = 5;

interface MatchRow {
  id: string;
  status: string;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  end_reason: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  /** Best-of state. `red_score`/`blue_score` track the OPEN round, not the series. */
  current_round?: number | null;
  rounds_json?: unknown;
  red_round_wins?: number | null;
  blue_round_wins?: number | null;
  awaiting_round_advance?: boolean | null;
}

/** Closed rounds from the `rounds_json` cache, tolerating null/non-array. */
const closedRounds = (match: MatchRow): unknown[] =>
  Array.isArray(match.rounds_json) ? match.rounds_json : [];

test.describe('scoring pad', () => {
  test.skip(!SCORING_PAD, 'set E2E_SCORING_PAD=1 to drive the scoring pad for real');

  test('clock state machine: legal transitions, and illegal ones are refused', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId } = await aMatch(api, 'clock');

    const state = async () =>
      (
        await api.json<{ status: string; totalActiveMs: number }>(
          await api.get(`matches/${matchId}/clock`),
        )
      ).status;
    const act = (action: string) => api.post(`matches/${matchId}/clock`, { data: { action } });

    expect(await state()).toBe('idle');

    // Only `start` is legal from idle — VALID_TRANSITIONS in clock.service.ts.
    expect((await act('halt')).status(), 'halt from idle must be refused').toBe(400);
    expect(await state()).toBe('idle');

    await api.ok(await act('start'));
    expect(await state()).toBe('running');
    // `resume` is not legal while already running.
    expect((await act('resume')).status(), 'resume while running must be refused').toBe(400);

    await api.ok(await act('halt'));
    expect(await state()).toBe('halted');
    await api.ok(await act('resume'));
    expect(await state()).toBe('running');

    await api.ok(await act('end'));
    expect(await state()).toBe('ended');
    // Ending the clock completes the match, even with no winner decided.
    expect((await readMatch(api, matchId)).status).toBe('completed');

    // `reopen` is the only way back, and it must clear the completion.
    await api.ok(await act('reopen'));
    expect(await state()).toBe('halted');
    const reopened = await readMatch(api, matchId);
    expect(reopened.status).not.toBe('completed');
  });

  test('accumulated active time survives halt/resume and follows adjustments', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId } = await aMatch(api, 'clockadj');

    await api.ok(await api.post(`matches/${matchId}/clock`, { data: { action: 'start' } }));
    await api.ok(await api.post(`matches/${matchId}/clock`, { data: { action: 'halt' } }));

    // Adjusting by a known amount is the only way to assert an exact figure —
    // elapsed wall-clock time is not deterministic enough to assert on.
    const before = await clockMs(api, matchId);
    await api.ok(
      await api.post(`matches/${matchId}/clock/adjust`, { data: { adjustmentMs: 60_000 } }),
    );
    expect(await clockMs(api, matchId)).toBe(before + 60_000);

    // The accumulated total must survive a resume/halt cycle rather than reset.
    await api.ok(await api.post(`matches/${matchId}/clock`, { data: { action: 'resume' } }));
    await api.ok(await api.post(`matches/${matchId}/clock`, { data: { action: 'halt' } }));
    expect(await clockMs(api, matchId)).toBeGreaterThanOrEqual(before + 60_000);
  });

  test('every exchange type moves the derived score by exactly the right amount', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId } = await aMatch(api, 'exchanges');

    // clean: the striker's value, nothing to the defender.
    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 });
    await expectScore(api, matchId, 2, 0);

    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'blue', firstStrikeValue: 1 });
    await expectScore(api, matchId, 2, 1);

    // double and no_exchange score for nobody — but must still persist, because
    // the double COUNT drives the max-doubles rule in pools.
    await hit(api, matchId, { type: 'double' });
    await hit(api, matchId, { type: 'no_exchange', noExchangeReason: 'reset' });
    await expectScore(api, matchId, 2, 1);

    const exchanges = await api.json<unknown[]>(await api.get(`matches/${matchId}/exchanges`));
    expect(exchanges, 'non-scoring exchanges must still be recorded').toHaveLength(4);
  });

  /**
   * The afterblow contract, which is where scoring rules actually differ between
   * federations. `computeAfterblowDeltas`:
   *   full      → attacker +attackerPts, defender +defenderPts
   *   deductive → attacker +max(0, attackerPts - defenderPts), defender +0
   *
   * Identical exchange rows, two tournaments, two different results. This is
   * what "exchanges store RAW values, the mode is applied at derivation" means
   * in practice, and it cannot be checked without a real scoring round-trip.
   */
  test('afterblow nets differently under full and deductive modes', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);

    const full = await aMatch(api, 'ab-full', { afterblowMode: 'full' });
    await hit(api, full.matchId, {
      type: 'afterblow',
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      afterblowValue: 1,
    });
    await expectScore(api, full.matchId, 2, 1);

    const deductive = await aMatch(api, 'ab-ded', { afterblowMode: 'deductive' });
    await hit(api, deductive.matchId, {
      type: 'afterblow',
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      afterblowValue: 1,
    });
    await expectScore(api, deductive.matchId, 1, 0);
  });

  test('voiding an exchange recomputes the score, and reverting restores it', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId } = await aMatch(api, 'undo');

    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 });
    const second = await hit(api, matchId, {
      type: 'clean',
      firstStrikerColor: 'red',
      firstStrikeValue: 1,
    });
    await expectScore(api, matchId, 3, 0);

    // "Clear last" on the pad. The row is voided, not deleted — the timeline
    // must keep it — so the score has to come from re-deriving over non-voided
    // rows rather than from subtracting a delta.
    await api.ok(await api.patch(`exchanges/${second.id}/void`, { data: { reason: 'e2e undo' } }));
    await expectScore(api, matchId, 2, 0);

    await api.ok(await api.patch(`exchanges/${second.id}/revert-void`, { data: {} }));
    await expectScore(api, matchId, 3, 0);
  });

  /**
   * How a bracket match really ends: the engine closes it on the point cap and
   * picks the winner. Nothing in the product calls `PATCH /matches/:id/status`.
   */
  test('reaching the point cap completes the match and names the winner', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId, redRegistrationId } = await aMatch(api, 'pointcap');

    // Blue stops short; red takes the cap. Both sides at the cap would leave
    // pointCapWinnerColor with no answer and complete the match with NO winner.
    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'blue', firstStrikeValue: 2 });
    for (let i = 0; i < POINT_CAP; i++) {
      await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
    }

    const match = await readMatch(api, matchId);
    expect(match.status).toBe('completed');
    expect(match.end_reason).toBe('first_to_points');
    expect(match.winner_registration_id).toBe(redRegistrationId);
    expect(match.red_score).toBe(POINT_CAP);
    expect(match.blue_score).toBe(2);
  });

  /**
   * Best-of-3: the shape used for finals, and the one with real state to get
   * wrong. A round that hits the cap does NOT end the match — it is appended to
   * the `rounds_json` closed-round cache, the win tally moves, and the match
   * parks on `awaiting_round_advance` until an operator opens the next round.
   *
   * `red_score`/`blue_score` track the OPEN round, not the series; the series is
   * carried by `red_round_wins`/`blue_round_wins`. Conflating the two would show
   * a scoreboard that reads 5-0 for a fighter who is actually 1-1 down.
   */
  test('best-of-3 closes rounds, parks for advance, and ends on the win target', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    // All three phase values, because getEffectiveBestOf picks `finals` for a
    // medal match and a 2-fighter bracket's round 1 IS the final.
    const { matchId, redRegistrationId } = await aMatch(api, 'bo3', {
      bestOf: { pool: 3, bracket: 3, finals: 3 },
    });

    // ── Round 1: red takes the cap ────────────────────────────────────────
    for (let i = 0; i < POINT_CAP; i++) {
      await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
    }

    let match = await readMatch(api, matchId);
    expect(match.status, 'one round won must NOT complete a best-of-3').not.toBe('completed');
    expect(match.red_round_wins).toBe(1);
    expect(match.blue_round_wins).toBe(0);
    expect(match.awaiting_round_advance).toBe(true);
    expect(closedRounds(match), 'round 1 must be cached in rounds_json').toHaveLength(1);

    // Scoring is refused until the next round is opened — otherwise a stray hit
    // from the pad would land in a round that has already been decided.
    const stray = await api.post(`matches/${matchId}/exchanges`, {
      data: {
        clientUuid: randomUUID(),
        sequence: ++sequence,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
        occurredAt: new Date().toISOString(),
      },
    });
    expect(stray.status(), 'scoring while awaiting advance must be refused').toBe(400);

    // ── Round 2 ───────────────────────────────────────────────────────────
    const advanced = await api.json<{ currentRound: number }>(
      await api.post(`matches/${matchId}/rounds/advance`, { data: {} }),
    );
    expect(advanced.currentRound).toBe(2);

    match = await readMatch(api, matchId);
    expect(match.awaiting_round_advance).toBe(false);
    // The open round starts fresh: the previous round's 5-0 must not carry.
    expect({ red: match.red_score, blue: match.blue_score }).toEqual({ red: 0, blue: 0 });

    for (let i = 0; i < POINT_CAP; i++) {
      await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
    }

    // Two round wins is the target for best-of-3 (ceil(3/2)), so the series ends.
    match = await readMatch(api, matchId);
    expect(match.red_round_wins).toBe(2);
    expect(match.status).toBe('completed');
    expect(match.winner_registration_id).toBe(redRegistrationId);
    expect(closedRounds(match)).toHaveLength(2);
  });

  /**
   * The other way a round ends: time runs out and the leader takes it. Guarded
   * so it cannot be used to fake a result — refused on a single-round match,
   * and refused twice on the same round.
   */
  test('ending a round on time awards it to the leader', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId, blueRegistrationId } = await aMatch(api, 'bo3-time', {
      bestOf: { pool: 3, bracket: 3, finals: 3 },
    });

    // Blue leads 2-1 with nobody near the cap.
    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'blue', firstStrikeValue: 2 });
    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });

    await api.ok(await api.post(`matches/${matchId}/rounds/end`, { data: {} }));

    const match = await readMatch(api, matchId);
    expect(match.blue_round_wins, 'the leader takes the round').toBe(1);
    expect(match.red_round_wins).toBe(0);
    expect(match.awaiting_round_advance).toBe(true);
    expect(closedRounds(match)).toHaveLength(1);
    expect(match.status).not.toBe('completed');
    expect(blueRegistrationId).toBeTruthy();

    // Closing the same round twice would invent a round win out of nothing.
    const again = await api.post(`matches/${matchId}/rounds/end`, { data: {} });
    expect(again.status(), 'ending an already-ended round must be refused').toBe(400);
  });

  test('ending a round is refused on a single-round match', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId } = await aMatch(api, 'bo1');

    const res = await api.post(`matches/${matchId}/rounds/end`, { data: {} });
    expect(res.status(), 'rounds/end has no meaning without best-of').toBe(400);
  });

  test('a manual referee card is recorded against the right fighter', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { matchId, blueRegistrationId } = await aMatch(api, 'cards');

    await api.ok(
      await api.post(`matches/${matchId}/penalties`, {
        data: {
          clientUuid: randomUUID(),
          sequence: 1,
          registrationId: blueRegistrationId,
          directCard: 'yellow',
          reason: 'e2e manual card',
          occurredAt: new Date().toISOString(),
        },
      }),
    );

    const penalties = await api.json<Array<Record<string, unknown>>>(
      await api.get(`matches/${matchId}/penalties`),
    );
    expect(penalties).toHaveLength(1);
    expect(penalties[0]?.['registration_id'] ?? penalties[0]?.['registrationId']).toBe(
      blueRegistrationId,
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A single playable match to score against.
 *
 * Built as a 2-fighter double-elim bracket: the smallest shape that yields one
 * real match row wired to a phase and a ruleset, with no pools to finish first.
 * Each test gets its own so a completed match never leaks into the next case.
 */
async function aMatch(
  api: Api,
  key: string,
  opts: {
    afterblowMode?: 'full' | 'deductive';
    bestOf?: { pool: number; bracket: number; finals: number };
  } = {},
): Promise<{
  tournamentId: string;
  matchId: string;
  redRegistrationId: string;
  blueRegistrationId: string;
}> {
  const { eventId } = runContext();
  const roster: Person[] = await ensurePersons(api, eventId, 2);
  const token = `${key}-${Date.now().toString(36)}`;

  const tournament = await createBracketTournament(api, eventId, {
    name: `Pad ${key}`,
    slug: `pad-${token}`,
    fighters: roster.slice(0, 2),
  });

  // pointCap must go through a PATCH: createTournament only started honouring
  // rulesetConfig recently, and afterblowMode lives on scoringConfig.
  await api.ok(
    await api.patch(`tournaments/${tournament.id}`, {
      data: {
        rulesetConfig: {
          matchFormat: { pointCap: POINT_CAP, ...(opts.bestOf ? { bestOf: opts.bestOf } : {}) },
        },
        ...(opts.afterblowMode ? { scoringConfig: { afterblowMode: opts.afterblowMode } } : {}),
      },
    }),
  );

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-bracket`, {
      data: { phaseType: 'double_elim', qualifyCount: 2 },
    }),
  );
  await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

  const bracket = await api.json<{
    slots: Array<{
      round: number;
      matchId: string | null;
      redRegistrationId: string | null;
      blueRegistrationId: string | null;
    }>;
  }>(await api.get(`tournaments/${tournament.id}/bracket`));

  const slot = bracket.slots.find(
    (s) => s.round === 1 && s.matchId && s.redRegistrationId && s.blueRegistrationId,
  );
  expect(slot, `no playable round-1 match for ${key}`).toBeDefined();

  return {
    tournamentId: tournament.id,
    matchId: slot!.matchId as string,
    redRegistrationId: slot!.redRegistrationId as string,
    blueRegistrationId: slot!.blueRegistrationId as string,
  };
}

let sequence = 0;

/** Post one exchange the way the pad does, and return the created row. */
async function hit(
  api: Api,
  matchId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  return api.json<{ id: string }>(
    await api.post(`matches/${matchId}/exchanges`, {
      data: {
        clientUuid: randomUUID(),
        sequence: ++sequence,
        occurredAt: new Date().toISOString(),
        clockTimeMs: sequence * 5_000,
        ...body,
      },
    }),
  );
}

const readMatch = async (api: Api, matchId: string): Promise<MatchRow> =>
  api.json<MatchRow>(await api.get(`matches/${matchId}`));

/** Assert the PERSISTED score equals what the engine should have derived. */
async function expectScore(api: Api, matchId: string, red: number, blue: number): Promise<void> {
  const match = await api.json<MatchRow>(await api.get(`matches/${matchId}`));
  expect({ red: match.red_score, blue: match.blue_score }).toEqual({ red, blue });
}

async function clockMs(api: Api, matchId: string): Promise<number> {
  const state = await api.json<{ totalActiveMs: number }>(
    await api.get(`matches/${matchId}/clock`),
  );
  return state.totalActiveMs;
}
