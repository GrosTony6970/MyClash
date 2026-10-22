import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { scoreMatch } from './_bracket';
import { buildSwissTournament, readSwiss, readSwissAdmin, waitForRoundOnly } from './_swiss';

/**
 * A Swiss Fighter's pairings follow their status, end to end against a real database (slice
 * B-Swiss; run with E2E_SWISS=1, nightly beside `22-swiss`). Rulings 77, 81, 109, 123 and 124:
 * withdrawn on the participants page while paired in a bout not started, the Fighter's bout is
 * forfeited, the round closes on that forfeit and the next round pairs without them; the undo puts
 * the bout back, and the Fighter stays out of the pairings, a round having been paired without them.
 * Rulings 125 and 127: a Fighter out while the phase is finalised is left alone, and followed once
 * it resumes.
 *
 * What the database functions decide under the phase lock is check 17 of the RLS probe; this is
 * the one place the doors, the reconcile and the completion owner run together.
 */
const SWISS = ['1', 'true', 'yes'].includes((process.env.E2E_SWISS ?? '').toLowerCase());

test.describe(SWISS ? 'Swiss status' : 'Swiss status (set E2E_SWISS=1 to run)', () => {
  test.skip(!SWISS, 'Writes real tournaments and scores real matches; opt in with E2E_SWISS=1.');

  test('a Fighter withdrawn while paired: their bout forfeited, the next round without them', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { tournament } = await buildSwissTournament(api, runContext().eventId, {
      key: `status-${Date.now().toString(36)}`,
      count: 4,
      roundCount: 3,
    });
    const opening = await readSwiss(api, tournament.id);
    const [fought, theirs] = opening.rounds[0]!.matches;
    expect(fought, 'four Fighters pair two bouts').toBeDefined();
    expect(theirs).toBeDefined();
    const leaving = theirs!.redRegistrationId!;

    // The other bout of round 1 is fought: only the leaving Fighter's bout keeps the round open.
    await scoreMatch(api, fought!.id, 'red');
    await api.ok(
      await api.patch(`registrations/${leaving}/status`, { data: { status: 'withdrawn' } }),
    );

    const forfeit = await activeForfeit(api, theirs!.id);
    expect(forfeit, 'the paired bout not started is forfeited (123)').not.toBeNull();
    expect(forfeit!.reason, 'a withdrawal by hand is a voluntary forfeit').toBe('voluntary');
    expect(forfeit!.auto_created).toBe(true);

    // The forfeit closed round 1, so round 2 pairs, without them (77, 109).
    const second = await waitForRoundOnly(api, tournament.id, 2);
    expect(second, 'a round closed by a forfeit pairs the next one (109)').not.toBeNull();
    const paired = second!.matches.flatMap((m) => [m.redRegistrationId, m.blueRegistrationId]);
    expect(paired, 'the next round pairs without them (77)').not.toContain(leaving);
    expect(second!.byeRegistrationId).not.toBe(leaving);
    expect(await withdrawnAt(api, tournament.id, leaving)).toBe(2);
    expect(await roundStatus(api, tournament.id, 1)).toBe('completed');

    // The undo: the bout forfeited because they were out is back on (124) ...
    await api.ok(
      await api.patch(`registrations/${leaving}/status`, { data: { status: 'registered' } }),
    );
    expect(await activeForfeit(api, theirs!.id), 'the undo brings the bout back').toBeNull();
    expect(await matchStatus(api, theirs!.id)).toBe('scheduled');
    // ... its round reopened, read from the bouts as they now are.
    expect(await roundStatus(api, tournament.id, 1), 'round 1 reopens').not.toBe('completed');
    // ... and they stay out of the pairings: round 2 was paired without them (81).
    expect(await withdrawnAt(api, tournament.id, leaving)).toBe(2);
  });

  test('a Fighter out while the phase is finalised follows it once it resumes (125, 127)', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { tournament } = await buildSwissTournament(api, runContext().eventId, {
      key: `reopen-${Date.now().toString(36)}`,
      count: 4,
      roundCount: 3,
    });
    const opening = await readSwiss(api, tournament.id);
    const theirs = opening.rounds[0]!.matches[0]!;
    const leaving = theirs.redRegistrationId!;
    const phase = `swiss-phases/${opening.phaseId}`;

    await api.ok(await api.post(`${phase}/finalise`, { data: {} }));
    await api.ok(
      await api.patch(`registrations/${leaving}/status`, { data: { status: 'withdrawn' } }),
    );
    // A finalised phase is left alone (125).
    expect(await withdrawnAt(api, tournament.id, leaving)).toBeNull();
    expect(await activeForfeit(api, theirs.id)).toBeNull();

    await api.ok(await api.post(`${phase}/resume`, { data: {} }));
    // Open again, it follows them as if it had run all along (127).
    expect(await withdrawnAt(api, tournament.id, leaving), 'out of the next round').toBe(2);
    expect(await activeForfeit(api, theirs.id), 'their bout not started (123)').not.toBeNull();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ForfeitRow {
  reason: string;
  auto_created: boolean;
}

/** The one live forfeit on a bout, or null (`GET /matches/:id/forfeit` answers a bare null). */
async function activeForfeit(api: Api, matchId: string): Promise<ForfeitRow | null> {
  const body = (await (await api.ok(await api.get(`matches/${matchId}/forfeit`))).text()).trim();
  if (!body || body === 'null') return null;
  return JSON.parse(body) as ForfeitRow;
}

async function matchStatus(api: Api, matchId: string): Promise<string> {
  const match = await api.json<{ status: string }>(await api.get(`matches/${matchId}`));
  return match.status;
}

async function roundStatus(api: Api, tournamentId: string, roundNumber: number) {
  const { rounds } = await readSwiss(api, tournamentId);
  return rounds.find((round) => round.roundNumber === roundNumber)?.status;
}

/** The round an entrant is out of the pairings from, as the Configure tab reads it. */
async function withdrawnAt(api: Api, tournamentId: string, registrationId: string) {
  const view = await readSwissAdmin(api, tournamentId);
  return view.entrants.find((entrant) => entrant.registrationId === registrationId)
    ?.withdrawnAtRound;
}
