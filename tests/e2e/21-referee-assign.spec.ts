import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensureRoster, type Person } from './_bracket';

/**
 * The rules the referee board is supposed to enforce (run with
 * `E2E_SCHEDULE=1`).
 *
 * `05-referee-board.spec.ts` drives auto-assign through the UI and asserts two
 * things: every role slot got filled, and a fighter was not made referee of
 * their own pool. Six assertions for 33 endpoints. What it never asks is
 * whether the board respects the two facts an organiser actually curates —
 * **who is qualified for a role**, and **who is available at all**.
 *
 * Those are the assignments that hurt: a referee handed a role they are not
 * certified for, or rostered on a day they told you they could not come. Both
 * look exactly like a correct assignment on the board.
 *
 * It builds its own `event_kind: 'test'` event for the same reason `20` does —
 * auto-assign is event-wide, so run in the shared throwaway event it would be
 * grading whatever `05` and `18` happened to leave behind.
 *
 * SAFE BY CONSTRUCTION: `lock-referee-assignments` fires three notification
 * paths (`scheduleRefereeAssignmentStarting`, `scheduleRefereeStarting`,
 * `assignmentChanged`). Every one of them returns early without a
 * `claimed_by_user_id`, and the follow path additionally needs a follower.
 * Every referee here is a fresh unclaimed `ensureRoster` person with no
 * followers, so nothing is ever sent. Do not put a claimed person on this board.
 */
const SCHEDULE = ['1', 'true', 'yes'].includes((process.env.E2E_SCHEDULE ?? '').toLowerCase());

/** The three system roles every pool slot is built from. */
const ROLES = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];

interface BoardSlot {
  role?: string;
  assignment: { id: string; personId: string | null } | null;
}
interface BoardPool {
  poolId?: string;
  tournamentId: string;
  kind?: string;
  roleSlots: BoardSlot[];
}
interface Board {
  pools: BoardPool[];
  locked: boolean;
}

test.describe('referee assignment', () => {
  test.skip(!SCHEDULE, 'set E2E_SCHEDULE=1 to hold the referee board to its own rules');

  test('never assigns an unqualified or unavailable referee, and a locked board holds', async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);

    // ── An event of this spec's own ───────────────────────────────────────────
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) referees — ${token}`,
          slug: `e2e-referees-${token}`,
          startDate: '2099-04-01',
          endDate: '2099-04-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'test',
        },
      }),
    );
    const eventId = event.id;
    await api.ok(await api.post(`events/${eventId}/lices`, { data: { name: `Piste ${token}` } }));

    // Four fighters in one pool, plus a referee cast with three parts to play:
    // available and qualified, qualified but available only ELSEWHERE, and
    // registered but qualified for nothing.
    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: 4 }, (_, i) => ({ givenName: 'Reffight', familyName: `F${i + 1}` })),
    );
    // DELIBERATELY TOO FEW. A pool has three role slots and only TWO available
    // referees, so the unavailable one is not surplus — the engine needs them
    // and must still refuse to use them. With three available referees the
    // "unavailable was not assigned" assertion would pass merely because there
    // were enough others, which is how that kind of check goes quietly vacuous.
    const officials = await ensureRoster(api, eventId, [
      { givenName: 'Refqual', familyName: 'One' },
      { givenName: 'Refqual', familyName: 'Two' },
      { givenName: 'Refunavailable', familyName: 'One' },
      { givenName: 'Refunqualified', familyName: 'One' },
    ]);
    const qualified = officials.slice(0, 2);
    const unavailable = officials[2] as Person;
    const unqualified = officials[3] as Person;

    const tournament = await createBracketTournament(api, eventId, {
      name: `Referee Cup ${token}`,
      slug: `ref-${token}`,
      fighters,
    });
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
    );

    // Everyone is registered as an event referee — being ON the roster is not
    // the same as being eligible, and conflating the two is the bug this spec
    // is looking for.
    for (const person of officials) {
      await api.ok(await api.post(`events/${eventId}/referees/${person.id}`));
    }

    const globalIdOf = await globalPersonIds(api, eventId);
    const globalOf = (person: Person): string => globalIdOf.get(person.id) ?? person.id;

    // Qualifications key on the GLOBAL person id (post-0063). The unqualified
    // referee is granted NOTHING — that is the entire point of them.
    for (const person of [...qualified, unavailable]) {
      for (const role of ROLES) {
        await api.ok(
          await api.put(`events/${eventId}/referee-qualifications`, {
            data: { personId: globalOf(person), role, rating: 4 },
          }),
        );
      }
    }

    // …and one qualified referee is restricted to a DIFFERENT tournament.
    //
    // AN EMPTY ALLOWLIST DOES NOT MEAN "AVAILABLE FOR NOTHING". `isUnavailable`
    // only consults `availableTournamentIds` when it is non-empty, so
    // `{ availableAllTournaments: false, tournamentIds: [] }` leaves the referee
    // fully assignable — the boolean alone is never read. Expressing the
    // restriction the way the engine understands it means naming a tournament
    // that is not this one, which is why the spec creates a second one.
    //
    // NOTE THE IDENTITY TOO. Two endpoints share the `events/:eventId/referees/
    // :personId` shape and disagree about what `:personId` means: registration
    // (`ensureEventReferee`) accepts either id and resolves it, while
    // availability writes it straight at `event_referees.person_id`, a FK to
    // global_persons — pass an event-scoped id and you get an FK violation, not
    // a helpful 404. The admin UI passes the global id, so no user hits this;
    // a test that guessed the other way does.
    const elsewhere = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/tournaments`, {
        data: { name: `Elsewhere ${token}`, slug: `elsewhere-${token}`, weapon: 'longsword' },
      }),
    );
    await api.ok(
      await api.patch(`events/${eventId}/referees/${globalOf(unavailable)}/availability`, {
        data: { availableAllTournaments: false, tournamentIds: [elsewhere.id] },
      }),
    );

    // Schedule the pool so its slots exist on the conflict-aware board.
    const { block } = await api.json<{ block: { id: string } }>(
      await api.post(`events/${eventId}/programme/blocks`, {
        data: {
          dayIndex: 0,
          blockType: 'competition',
          label: `Pools ${token}`,
          startTime: '09:00',
          endTime: '18:00',
          liceCount: 1,
          matchGapSeconds: 30,
          matchDurationMinutes: 5,
          competitionId: tournament.id,
          competitionPhase: 'pool',
        },
      }),
    );
    expect(block?.id, 'the competition block must exist for slots to appear').toBeTruthy();
    await api.ok(await api.post(`events/${eventId}/programme/generate`, { data: {} }));

    // ── A manual assignment states the qualification rule outright ────────────
    const poolId = await firstPoolId(api, tournament.id);
    const refused = await api.post(`events/${eventId}/referee-assignments`, {
      data: { poolId, role: ROLES[0], personId: globalOf(unqualified) },
    });
    expect(
      refused.status(),
      `an unqualified referee must be refused: ${(await refused.text()).slice(0, 200)}`,
    ).toBe(400);
    expect(await refused.text(), 'and the refusal must say why').toMatch(/not qualified/i);

    // The same call for a QUALIFIED referee succeeds — otherwise the refusal
    // above could be any old rejection of this endpoint.
    await api.ok(
      await api.post(`events/${eventId}/referee-assignments`, {
        data: { poolId, role: ROLES[0], personId: globalOf(qualified[0] as Person) },
      }),
    );

    // ── Auto-assign, then hold the RESULT to the same two rules ───────────────
    await api.ok(await api.post(`events/${eventId}/referee-assignment-preview`));
    await api.ok(await api.post(`events/${eventId}/referee-assignment-preview/apply`));

    const board = await api.json<Board>(
      await api.get(`events/${eventId}/referee-assignment-board`),
    );
    const mySlots = board.pools
      .filter((p) => p.tournamentId === tournament.id && (p.kind ?? 'pool') === 'pool')
      .flatMap((p) => p.roleSlots);
    expect(mySlots.length, 'this tournament must have role slots to fill').toBeGreaterThan(0);

    const assignedPeople = mySlots
      .map((s) => s.assignment?.personId)
      .filter((id): id is string => Boolean(id));
    expect(assignedPeople.length, 'auto-assign must have filled something').toBeGreaterThan(0);

    // The two rules, stated as membership questions about real people.
    expect(
      assignedPeople,
      'a referee with NO qualification was put on a slot — the board invented a certification',
    ).not.toContain(globalOf(unqualified));
    expect(
      assignedPeople,
      'a referee whose availability excludes this tournament was rostered on it anyway',
    ).not.toContain(globalOf(unavailable));

    // The bite. There are more slots than available referees, so a board that
    // ignored availability would have HAD a body for every slot and filled them
    // all. Leaving one empty is the observable consequence of the rule — and it
    // is what stops the exclusion above from passing merely because the engine
    // had enough other people to choose from.
    expect(
      assignedPeople.length,
      'every slot was filled, but there were not enough AVAILABLE referees to do that honestly',
    ).toBeLessThan(mySlots.length);

    // …and the people who WERE assigned are all from the eligible set, so the
    // two exclusions above cannot be passing merely because nothing was
    // assigned to anyone.
    const eligible = new Set(qualified.map(globalOf));
    for (const personId of assignedPeople) {
      expect(eligible, `slot filled by ${personId}, who is not an eligible referee`).toContain(
        personId,
      );
    }

    // ── A locked board refuses edits ──────────────────────────────────────────
    const anAssignmentId = mySlots.find((s) => s.assignment?.id)?.assignment?.id;
    expect(anAssignmentId, 'no persisted assignment to lock').toBeTruthy();

    const lock = await api.json<{ confirmed: number }>(
      await api.post(`events/${eventId}/lock-referee-assignments`),
    );
    expect(lock.confirmed, 'locking must confirm the assignments that exist').toBeGreaterThan(0);
    expect(
      (await api.json<Board>(await api.get(`events/${eventId}/referee-assignment-board`))).locked,
      'the board must report itself locked',
    ).toBe(true);

    const blocked = await api.delete(`referee-assignments/${anAssignmentId}`);
    expect(
      blocked.status(),
      `a locked assignment must not be removable: ${(await blocked.text()).slice(0, 200)}`,
    ).toBe(409);
    expect(await blocked.text()).toMatch(/locked/i);

    // Unlock restores the board, and the same delete now goes through — which
    // is what proves the 409 came from the LOCK and not from the row.
    const unlocked = await api.json<{ reopened: number }>(
      await api.post(`events/${eventId}/unlock-referee-assignments`),
    );
    expect(unlocked.reopened, 'unlock must reopen what lock confirmed').toBeGreaterThan(0);
    await api.ok(await api.delete(`referee-assignments/${anAssignmentId}`));

    if (process.env.E2E_CLEANUP) {
      await api.delete(`events/${eventId}`);
    } else {
      console.log(`[e2e] referee event PRESERVED: ${eventId}`);
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** event-scoped persons.id → global_persons.id, which is what referees key on. */
async function globalPersonIds(api: Api, eventId: string): Promise<Map<string, string>> {
  const persons = await api.json<Array<{ id: string; globalPersonId: string | null }>>(
    await api.get(`events/${eventId}/persons`),
  );
  return new Map(persons.filter((p) => p.globalPersonId).map((p) => [p.id, p.globalPersonId!]));
}

/** `pools-with-matches` names the pool `poolId`, not `id`. */
async function firstPoolId(api: Api, tournamentId: string): Promise<string> {
  const pools = await api.json<Array<{ poolId: string }>>(
    await api.get(`tournaments/${tournamentId}/pools-with-matches`),
  );
  expect(pools[0]?.poolId, 'the tournament produced no pool').toBeTruthy();
  return pools[0]!.poolId;
}
