import { test, expect, type APIResponse } from '@playwright/test';
import { runContext } from './_context';

/**
 * Referee assignment board (web-admin) — drives the real UI auto-assign and
 * verifies the outcome against the board API.
 *
 * Seeds a self-contained tournament in the shared throwaway event via API: 4
 * fighters → one round-robin pool, scheduled across a lice, plus 6 pure
 * (non-fighting) referees AND one fighter who is also a qualified referee. Then
 * it opens `…/referees#assignments`, runs Preview → Apply auto-assign through the
 * UI, and asserts via `GET /events/:id/referee-assignment-board` that:
 *   - every role slot of THIS tournament's pool is filled (verified per-tournament
 *     so other specs' pools in the shared event can't affect the assertion), and
 *   - the fighter-referee was NOT assigned to their own pool (the engine's
 *     officiate-vs-fight conflict rule held).
 *
 * Event-scoped, so global-teardown's hard-delete cleans it up.
 */
test('auto-assign fills a pool and respects the fighter-vs-referee conflict', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { orgSlug, eventId } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  const ok = async (res: APIResponse, label: string): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
    return res;
  };
  const SKILLS = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];

  // ── Seed (API) ────────────────────────────────────────────────────────────
  await ok(
    await request.post(api(`events/${eventId}/lices`), { data: { name: `RB Lice ${tok}` } }),
    'create lice',
  );

  const createPerson = async (given: string): Promise<string> => {
    const res = await ok(
      await request.post(api(`events/${eventId}/persons`), {
        data: { givenName: given, familyName: `Rb${tok}` },
      }),
      `create person ${given}`,
    );
    return ((await res.json()) as { id: string }).id;
  };

  const fighterIds: string[] = [];
  for (let i = 0; i < 4; i++) fighterIds.push(await createPerson(`Fighter${i}`));
  const refOnlyIds: string[] = [];
  for (let i = 0; i < 6; i++) refOnlyIds.push(await createPerson(`Ref${i}`));
  const fighterRefId = fighterIds[0]!; // also a referee → must be BLOCKED on its own pool

  const tRes = await ok(
    await request.post(api(`events/${eventId}/tournaments`), {
      data: { name: `RB Cup ${tok}`, slug: `rb-${tok}` },
    }),
    'create tournament',
  );
  const tournamentId = ((await tRes.json()) as { id: string }).id;

  for (const personId of fighterIds) {
    await ok(
      await request.post(api(`tournaments/${tournamentId}/registrations`), { data: { personId } }),
      'register fighter',
    );
  }
  await ok(
    await request.post(api(`tournaments/${tournamentId}/generate-pools`), {
      data: { poolCount: 1 },
    }),
    'generate pools',
  );

  // Referees: the 6 pure refs + the fighter-referee, each fully qualified.
  const refereeIds = [...refOnlyIds, fighterRefId];
  for (const personId of refereeIds) {
    await ok(await request.post(api(`events/${eventId}/referees/${personId}`)), 'register referee');
  }
  const persons = (await (
    await ok(await request.get(api(`events/${eventId}/persons`)), 'list persons')
  ).json()) as Array<{ id: string; globalPersonId: string | null }>;
  const globalOf = new Map(persons.map((p) => [p.id, p.globalPersonId ?? p.id]));
  const fighterRefGlobalId = globalOf.get(fighterRefId) ?? fighterRefId;
  for (const personId of refereeIds) {
    for (const role of SKILLS) {
      await ok(
        await request.put(api(`events/${eventId}/referee-qualifications`), {
          data: { personId: globalOf.get(personId) ?? personId, role, rating: 4 },
        }),
        'grant qualification',
      );
    }
  }

  // Schedule the pool so its slots appear on the conflict-aware board.
  await ok(
    await request.post(api(`events/${eventId}/programme/blocks`), {
      data: {
        dayIndex: 0,
        blockType: 'competition',
        label: `RB Pools ${tok}`,
        startTime: '09:00',
        endTime: '18:00',
        liceCount: 1,
        matchGapSeconds: 30,
        matchDurationMinutes: 5,
        competitionId: tournamentId,
        competitionPhase: 'pool',
      },
    }),
    'create competition block',
  );
  await ok(
    await request.post(api(`events/${eventId}/programme/generate`), { data: {} }),
    'generate schedule',
  );

  // ── UI: run auto-assign on the board ───────────────────────────────────────
  await page.goto(`/org/${orgSlug}/events/${eventId}/referees#assignments`);
  const previewBtn = page.getByRole('button', { name: 'Preview auto assign' });
  await expect(previewBtn).toBeVisible({ timeout: 30_000 });
  await previewBtn.click();

  const applyBtn = page.getByRole('button', { name: 'Apply auto assign' });
  await expect(applyBtn).toBeVisible({ timeout: 30_000 });
  await applyBtn.click();
  // Clicking Apply relabels the button to "Applying…" then clears the proposals on
  // success and reloads the board. The Preview button is disabled throughout the
  // preview/apply cycle and re-enables only once the saved board has reloaded — so
  // wait on that (not the Apply label, which merely changes to "Applying…").
  await expect(previewBtn).toBeEnabled({ timeout: 45_000 });

  // ── Verify via the board API (per-tournament, robust to other specs' pools) ──
  type BoardSlot = { assignment: { personId: string | null } | null };
  type BoardPool = { tournamentId: string; kind?: string; roleSlots: BoardSlot[] };
  const board = (await (
    await ok(
      await request.get(api(`events/${eventId}/referee-assignment-board`)),
      'load assignment board',
    )
  ).json()) as { pools: BoardPool[] };

  const myPoolSlots = board.pools
    .filter((p) => p.tournamentId === tournamentId && (p.kind ?? 'pool') === 'pool')
    .flatMap((p) => p.roleSlots);

  expect(myPoolSlots.length).toBeGreaterThan(0);
  // Every role slot of this tournament's pool is staffed by auto-assign.
  expect(myPoolSlots.every((s) => s.assignment !== null)).toBe(true);
  // The fighter-referee was never assigned to their own pool (conflict respected).
  expect(myPoolSlots.some((s) => s.assignment?.personId === fighterRefGlobalId)).toBe(false);
});
