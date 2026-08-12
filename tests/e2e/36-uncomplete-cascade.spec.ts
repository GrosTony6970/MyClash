import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import {
  apiFor,
  createBracketTournament,
  ensureRoster,
  nextExchangeSequence,
  readBracket,
  scoreMatch,
  type Api,
  type Bracket,
  type BracketSlot,
} from './_bracket';

/**
 * Undo a bout, replay it, and check the bracket follows.
 *
 * This is the one thing the un-completion owner cannot be proved by unit tests.
 * Advancement feeds its own input — the winner of one bout becomes a side of the
 * next — so the defect is cumulative by construction: `advanceFromSlot` writes a
 * downstream side ONLY while it is null, which is what makes re-advancing
 * idempotent and what made a stale side permanent. A mocked Supabase agrees with
 * whatever the mock was told; only real rows can say whether round 2 ends up
 * naming the fighter who actually won round 1 the second time.
 *
 * Both tests fail on 4ba8ce63, in different ways:
 *   - the first leaves round 2 carrying the loser of the replay, silently;
 *   - the second could not even be attempted, because nothing refused, nothing
 *     warned, and nothing put the invalidated bout back on the schedule.
 *
 * Four fighters, single elimination, no pools — with no pool phase
 * `populateBracket` seeds straight from the registration order, so the draw and
 * therefore every assertion below is deterministic.
 */
const UNCOMPLETE = ['1', 'true', 'yes'].includes((process.env.E2E_UNCOMPLETE ?? '').toLowerCase());

const FIELD = 4;

interface Preflight {
  affected: Array<{
    label: string | null;
    redName: string | null;
    blueName: string | null;
    round: number;
    hasBeenFought: boolean;
  }>;
  foughtCount: number;
  blocked: boolean;
  canDiscard: boolean;
  frozen: boolean;
}

const slotAt = (bracket: Bracket, round: number, position: number): BracketSlot => {
  const slot = bracket.slots.find((s) => s.round === round && s.position === position);
  if (!slot) throw new Error(`no slot at R${round}P${position}`);
  return slot;
};

/** Both sides of a slot, as the bracket currently reports them. */
const sidesOf = (slot: BracketSlot) => [slot.redRegistrationId, slot.blueRegistrationId];

async function buildBracket(api: Api, eventId: string, token: string) {
  const fighters = await ensureRoster(
    api,
    eventId,
    Array.from({ length: FIELD }, (_unused, i) => ({
      givenName: 'Uncomplete',
      familyName: String(i + 1).padStart(2, '0'),
    })),
  );
  const tournament = await createBracketTournament(api, eventId, {
    name: `Uncomplete ${token}`,
    slug: `uncomplete-${token}`,
    fighters,
  });
  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-bracket`, {
      data: { phaseType: 'single_elim' },
    }),
  );
  await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));
  return tournament;
}

const title = UNCOMPLETE
  ? 'un-completing a bracket match'
  : 'un-completing a bracket match (set E2E_UNCOMPLETE=1 to run)';

test.describe(title, () => {
  test.skip(
    !UNCOMPLETE,
    'Plays, resets and replays real bracket matches; opt in with E2E_UNCOMPLETE=1.',
  );

  test('a replayed bout sends its REAL winner to the next round', async ({ request }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const tournament = await buildBracket(api, eventId, Date.now().toString(36));

    const initial = await readBracket(api, tournament.id);
    const r1 = slotAt(initial, 1, 1);
    const [red, blue] = sidesOf(r1);
    expect(red, 'round 1 is populated from the registration seeds').toBeTruthy();
    expect(blue).toBeTruthy();

    // Red wins. The next round should carry red.
    await scoreMatch(api, r1.matchId as string, 'red');
    const advanced = await readBracket(api, tournament.id);
    expect(sidesOf(slotAt(advanced, 2, 1)), 'the winner of R1P1 is fed into the final').toContain(
      red,
    );

    // Nothing downstream has been fought, so the pre-flight must say so and the
    // reset must go through without any acknowledgement.
    const preflight = await api.json<Preflight>(
      await api.get(`matches/${r1.matchId}/uncomplete-preflight`),
    );
    expect(preflight.blocked, 'the final has not been played, so nothing is at risk').toBe(false);
    expect(preflight.foughtCount).toBe(0);
    expect(preflight.affected.length, 'the final is still reported as affected').toBeGreaterThan(0);

    await api.ok(
      await api.post(`matches/${r1.matchId}/reset`, {
        data: { confirmation: 'RESET MATCH', reason: 'e2e: undo and replay' },
      }),
    );

    const cleared = await readBracket(api, tournament.id);
    expect(
      sidesOf(slotAt(cleared, 2, 1)).filter(Boolean),
      'the side the reset bout fed is emptied',
    ).not.toContain(red);

    // Replay it the other way. Sequences continue past the voided ones —
    // UNIQUE(match_id, sequence) still covers them.
    await scoreMatch(
      api,
      r1.matchId as string,
      'blue',
      undefined,
      await nextExchangeSequence(api, r1.matchId as string),
    );

    const replayed = await readBracket(api, tournament.id);
    const finalSides = sidesOf(slotAt(replayed, 2, 1));
    // THE DEFECT, in one assertion. On 4ba8ce63 the final still names `red`.
    expect(finalSides, 'the final carries the winner of the REPLAY').toContain(blue);
    expect(finalSides, 'and no longer carries the fighter who lost it').not.toContain(red);
  });

  test('an organiser can undo a result that a played bout depends on', async ({ request }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const tournament = await buildBracket(api, eventId, `${Date.now().toString(36)}b`);

    const initial = await readBracket(api, tournament.id);
    const r1p1 = slotAt(initial, 1, 1);
    const r1p2 = slotAt(initial, 1, 2);
    const [redR1] = sidesOf(r1p1);

    // Play the whole first round, then the final on top of it.
    await scoreMatch(api, r1p1.matchId as string, 'red');
    await scoreMatch(api, r1p2.matchId as string, 'red');
    const beforeFinal = await readBracket(api, tournament.id);
    const finalSlot = slotAt(beforeFinal, 2, 1);
    expect(finalSlot.matchId, 'the final exists once both feeders are decided').toBeTruthy();
    await scoreMatch(api, finalSlot.matchId as string, 'red');

    const played = await readBracket(api, tournament.id);
    expect(slotAt(played, 2, 1).status, 'the final has been fought').toBe('completed');

    // The pre-flight names it, and says this actor could push through.
    const preflight = await api.json<Preflight>(
      await api.get(`matches/${r1p1.matchId}/uncomplete-preflight`),
    );
    expect(preflight.blocked).toBe(true);
    expect(preflight.foughtCount, 'the final is the one fought dependent').toBe(1);
    expect(
      preflight.affected.some((bout) => bout.hasBeenFought && bout.redName),
      'affected bouts are named, never reported as bare ids',
    ).toBe(true);
    expect(preflight.canDiscard, 'the e2e account is an org admin').toBe(true);

    // Without the acknowledgement it is refused, and refused BEFORE any write.
    const refused = await api.post(`matches/${r1p1.matchId}/reset`, {
      data: { confirmation: 'RESET MATCH', reason: 'e2e: no acknowledgement' },
    });
    expect(refused.status(), 'a fought dependent blocks the reset').toBe(409);
    expect(
      slotAt(await readBracket(api, tournament.id), 2, 1).status,
      'the refusal left the final exactly as it was',
    ).toBe('completed');

    // With it, the final goes back on the schedule to be re-fought.
    await api.ok(
      await api.post(`matches/${r1p1.matchId}/reset`, {
        data: {
          confirmation: 'RESET MATCH',
          reason: 'e2e: undo and accept the loss',
          discardDependentResults: true,
        },
      }),
    );

    const cascaded = await readBracket(api, tournament.id);
    const finalAfter = slotAt(cascaded, 2, 1);
    expect(finalAfter.status, 'the final is unplayed again').toBe('scheduled');
    expect(finalAfter.winnerRegistrationId).toBeNull();
    expect(
      sidesOf(finalAfter).filter(Boolean),
      'and it no longer names the fighter whose result was undone',
    ).not.toContain(redR1);

    // Re-complete the feeder the other way; the bracket refills itself.
    const [, blueR1] = sidesOf(slotAt(cascaded, 1, 1));
    await scoreMatch(
      api,
      r1p1.matchId as string,
      'blue',
      undefined,
      await nextExchangeSequence(api, r1p1.matchId as string),
    );

    const refilled = await readBracket(api, tournament.id);
    expect(
      sidesOf(slotAt(refilled, 2, 1)),
      'the re-fought final is seeded with the replay winner',
    ).toContain(blueR1);
  });
});
