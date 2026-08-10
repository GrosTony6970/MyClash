import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureRoster } from './_bracket';
import { colorOf, createPoolTournament, poll, readPoolMatches } from './_pool';

/**
 * A withdrawal, one bout put back on, a fresh forfeit written on it, and the
 * withdrawal undone — against real rows.
 *
 * Two invariants shipped in this area, and neither is checkable against a mocked
 * Supabase, because both are about what OTHER rows say afterwards:
 *
 *   - a forfeit re-recorded on a reopened bout hangs off the ROOT withdrawal,
 *     not off the child it replaced. `cascadeVoidChildren` is one query deep, so
 *     a tree of depth 2 leaves grandchildren active when the root is voided — an
 *     F standing in the standings for a fighter who is back in the tournament,
 *     with nothing left pointing at it.
 *   - `getActiveForfeit` reports `{role, childCount, parentActive}`, which the
 *     admin page branches its confirm copy on. `parentActive` in particular
 *     cannot be derived on the frontend: the row says a parent EXISTS, never
 *     whether it still stands.
 *
 * One pool of four, so the fighter who withdraws has exactly three bouts — the
 * one they withdrew in, and two the cascade closes. Nothing is played first: an
 * injury in the first bout of the day is the realistic shape, and it keeps every
 * count below exact.
 */
const FORFEIT = ['1', 'true', 'yes'].includes((process.env.E2E_FORFEIT ?? '').toLowerCase());

const FIELD = 4;
/** The bouts the cascade closes: everything but the one they withdrew in. */
const CASCADED = FIELD - 2;

interface ForfeitRow {
  id: string;
  match_id: string;
  parent_forfeit_id: string | null;
  auto_created: boolean;
  voided_at: string | null;
  reason: string;
  cascade?: { role: 'root' | 'child' | 'standalone'; childCount: number; parentActive: boolean };
}

const title = FORFEIT ? 'pool forfeit cascade' : 'pool forfeit cascade (set E2E_FORFEIT=1 to run)';

test.describe(title, () => {
  test.skip(!FORFEIT, 'Withdraws a fighter and writes real forfeits; opt in with E2E_FORFEIT=1.');

  test('a forfeit re-recorded on a reopened bout is swept up by voiding the root', async ({
    request,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const token = Date.now().toString(36);

    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: FIELD }, (_, i) => ({
        givenName: 'Cascade',
        familyName: String(i + 1).padStart(2, '0'),
      })),
    );
    const tournament = await createPoolTournament(api, eventId, {
      name: `Forfeit cascade ${token}`,
      slug: `forfeit-cascade-${token}`,
      fighters,
      poolCount: 1,
    });

    // The fighter who will withdraw, and their three bouts.
    const casualty = tournament.registrationIdByPersonId.get(fighters[0]!.id) as string;
    const theirBouts = (await readPoolMatches(api, tournament.id)).filter(
      (match) => colorOf(match, casualty) !== null,
    );
    expect(
      theirBouts,
      `a round robin of ${FIELD} gives each fighter ${FIELD - 1} bouts`,
    ).toHaveLength(FIELD - 1);
    const [woundedIn, ...remaining] = theirBouts;

    // ── The withdrawal ─────────────────────────────────────────────────────
    const root = await api.json<ForfeitRow>(
      await api.post(`matches/${woundedIn!.id}/forfeit`, {
        data: {
          forfeitingRegistrationId: casualty,
          reason: 'injury',
          // The whole cascade hangs off this flag: it is what withdraws the
          // fighter and auto-forfeits their remaining pool bouts.
          canContinue: false,
        },
      }),
    );
    expect(root.parent_forfeit_id, 'the withdrawal is a root').toBeNull();

    for (const bout of remaining) {
      const child = await activeForfeit(api, bout.id);
      expect(child, `bout ${bout.id.slice(0, 8)} was not auto-forfeited`).not.toBeNull();
      expect(child!.auto_created, 'a cascaded forfeit is auto-created').toBe(true);
      expect(child!.parent_forfeit_id, 'and it names the withdrawal').toBe(root.id);
    }
    expect(
      await registrationStatus(api, tournament.id, casualty),
      'a withdrawal withdraws the fighter',
    ).toBe('withdrawn');

    // ── The cascade context the admin page branches its copy on ────────────
    const rootView = await activeForfeit(api, woundedIn!.id);
    expect(rootView?.cascade, 'this deploy does not report the cascade block').toBeDefined();
    expect(rootView!.cascade).toEqual({ role: 'root', childCount: CASCADED, parentActive: false });

    const reopenTarget = remaining[0]!;
    const childBefore = await activeForfeit(api, reopenTarget.id);
    expect(
      childBefore!.cascade,
      'a child must know its parent still stands — its own row cannot say',
    ).toEqual({ role: 'child', childCount: 0, parentActive: true });

    // ── Put one bout back on ───────────────────────────────────────────────
    // Voiding a cascaded child was always possible; what was missing is what
    // happens next.
    await api.ok(await api.patch(`match-forfeits/${childBefore!.id}/void`, {}));
    expect(await matchStatus(api, reopenTarget.id), 'voiding a child puts its bout back on').toBe(
      'scheduled',
    );
    expect(await activeForfeit(api, reopenTarget.id), 'and leaves no live record').toBeNull();
    expect(
      await registrationStatus(api, tournament.id, casualty),
      'the fighter stays withdrawn — the ROOT owns their status, not the child',
    ).toBe('withdrawn');

    // ── Write a fresh forfeit on the reopened bout ─────────────────────────
    // The organiser decides the fighter cannot take this one either. Before the
    // fix this became a root of its own, and voiding the injury no longer swept
    // it up.
    const rerecorded = await api.json<ForfeitRow>(
      await api.post(`matches/${reopenTarget.id}/forfeit`, {
        data: { forfeitingRegistrationId: casualty, reason: 'voluntary', canContinue: true },
      }),
    );
    expect(
      rerecorded.parent_forfeit_id,
      'a forfeit written while a withdrawal stands must hang off the ROOT',
    ).toBe(root.id);
    expect(rerecorded.auto_created, 'it was written by hand, not by the cascade').toBe(false);

    expect((await activeForfeit(api, reopenTarget.id))!.cascade).toEqual({
      role: 'child',
      childCount: 0,
      parentActive: true,
    });
    expect(
      (await activeForfeit(api, woundedIn!.id))!.cascade?.childCount,
      'the root carries every live child again — the thread is unbroken',
    ).toBe(CASCADED);

    // ── Undo the withdrawal ────────────────────────────────────────────────
    const voided = await api.json<{ cascaded_forfeit_count: number }>(
      await api.patch(`match-forfeits/${root.id}/void`, {}),
    );
    expect(
      voided.cascaded_forfeit_count,
      'voiding the root must sweep up the re-recorded forfeit too, not only the auto ones',
    ).toBe(CASCADED);

    // Nothing left on record, every bout playable again. This is the assertion
    // the write-time flatten exists for: at depth 2 the re-recorded forfeit
    // would still be sitting here, active, with its parent voided.
    for (const bout of theirBouts) {
      expect(
        await activeForfeit(api, bout.id),
        `bout ${bout.id.slice(0, 8)} still carries a forfeit after the root was voided`,
      ).toBeNull();
      expect(await matchStatus(api, bout.id)).toBe('scheduled');
    }
    await poll(
      () => registrationStatus(api, tournament.id, casualty),
      (status) => status !== 'withdrawn',
      'voiding the withdrawal must reinstate the fighter',
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The one live forfeit on a match, with its computed cascade block, or null.
 *
 * `GET /matches/:id/forfeit` answers a bare `null` when there is no record, and
 * `APIResponse.json()` on an empty body throws — so the body is read as text and
 * both spellings of "nothing" are handled here rather than at four call sites.
 */
async function activeForfeit(api: Api, matchId: string): Promise<ForfeitRow | null> {
  const body = (await (await api.ok(await api.get(`matches/${matchId}/forfeit`))).text()).trim();
  if (!body || body === 'null') return null;
  return JSON.parse(body) as ForfeitRow;
}

async function matchStatus(api: Api, matchId: string): Promise<string> {
  const match = await api.json<{ status: string }>(await api.get(`matches/${matchId}`));
  return match.status;
}

/**
 * A registration's status — what the standings and the check-in desk both read.
 *
 * There is no `GET /registrations/:id`, so this goes through the tournament's
 * list. Cheap at this size, and it is the same projection the persons page uses.
 */
async function registrationStatus(
  api: Api,
  tournamentId: string,
  registrationId: string,
): Promise<string> {
  const rows = await api.json<Array<{ id: string; status: string }>>(
    await api.get(`tournaments/${tournamentId}/registrations`),
  );
  const row = rows.find((r) => r.id === registrationId);
  expect(
    row,
    `registration ${registrationId.slice(0, 8)} vanished from the tournament`,
  ).toBeTruthy();
  return row!.status;
}
