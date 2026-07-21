import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { runContext } from './_context';

/**
 * The custom ruleset is ORG-scoped, so global-teardown (which hard-deletes the
 * EVENT) does not reach it — it would leak one row per run. Track its id and
 * delete it after the test, whether or not the assertions passed.
 */
let createdRulesetId: string | null = null;
test.afterEach(async ({ request }) => {
  if (!createdRulesetId) return;
  const { orgId } = runContext();
  await request.delete(`/api/v1/organizations/${orgId}/custom-rulesets/${createdRulesetId}`);
  createdRulesetId = null;
});

/**
 * Offline scoring on an ORG-AUTHORED custom ruleset — the end-to-end proof that
 * self-service closes the loop: author a ruleset with its own grammar, point a
 * tournament at it, and score a bout offline on it.
 *
 * Mirrors 06-offline-sync, but the tournament runs on a freshly-authored custom
 * ruleset whose targets are Head=3 / Body=1 (not FFAMHE's Deep=2 / Shallow=1).
 * The distinctive `+3` / `+1` clean buttons are the assertion that matters:
 * createTournament SEEDED scoring_config_json.buttons from the ruleset's
 * grammar, and the pad rendered the seed — so a federation's own grammar reaches
 * the referee's surface without the pad ever resolving the ruleset ("seed, don't
 * resolve"). Weighted afterblow additionally yields the N×N grid.
 *
 * The offline half is identical to 06: one hit online (reaches the server), one
 * offline (queues durably in the IndexedDB outbox), reconnect (auto-drains, the
 * server has both). Raw button values are what's queued; the server nets them
 * under the tournament's mode at read — which is exactly why offline works for a
 * custom ruleset the pad never resolved.
 *
 * The tournament and match are event-scoped (global-teardown's hard-delete
 * cleans them up); the org-scoped ruleset is deleted by the afterEach above.
 */
test('offline scoring works on a custom-ruleset bout and auto-syncs', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  const { orgId, eventId, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  const scoringBase = (process.env.E2E_SCORING_URL ?? `${baseURL}/scoring`).replace(/\/$/, '');

  const ok = async (res: APIResponse, label: string): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
    return res;
  };
  const json = async <T>(res: APIResponse): Promise<T> => (await res.json()) as T;

  // ── Author a custom scoring ruleset (org endpoint → published, usable now) ───
  // Distinctive grammar: Head=3 / Body=1 so the seeded pad is provably NOT the
  // federal +2 / +1; weighted afterblow so the grid is the attacker×defender
  // product. `createForOrg` validates the score formula, so a real AST is sent.
  const ruleset = await json<{ id: string; code: string }>(
    await ok(
      await request.post(api(`organizations/${orgId}/custom-rulesets`), {
        data: {
          name: `E2E Custom ${tok}`,
          scoreFormula: { type: 'var', name: 'victories' },
          constants: { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 },
          tiebreakers: [{ variable: 'victories', direction: 'desc' }],
          targets: [
            { name: 'Head', value: 3 },
            { name: 'Body', value: 1 },
          ],
          hasAfterblow: true,
          afterblowValuation: 'weighted',
          afterblowFixedValue: 1,
          afterblowMode: 'deductive',
        },
      }),
      'author custom ruleset',
    ),
  );
  createdRulesetId = ruleset.id;

  // ── Seed a 2-fighter pool match on that ruleset (API) ───────────────────────
  await ok(
    await request.post(api(`events/${eventId}/lices`), { data: { name: `CR Lice ${tok}` } }),
    'create lice',
  );

  const createPerson = async (given: string): Promise<string> => {
    const res = await ok(
      await request.post(api(`events/${eventId}/persons`), {
        data: { givenName: given, familyName: `Cr${tok}` },
      }),
      `create person ${given}`,
    );
    return (await json<{ id: string }>(res)).id;
  };
  const fighterIds = [await createPerson('Alpha'), await createPerson('Bravo')];

  const tournamentId = (
    await json<{ id: string }>(
      await ok(
        await request.post(api(`events/${eventId}/tournaments`), {
          data: {
            name: `CR Cup ${tok}`,
            slug: `cr-${tok}`,
            // Point the tournament at the custom ruleset — createTournament
            // seeds scoring_config_json from its grammar.
            rulesetCode: ruleset.code,
            rulesetVersion: '1.0.0',
          },
        }),
        'create tournament',
      ),
    )
  ).id;

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

  type PwmMatch = {
    id: string;
    status: string;
    red_registration_id: string | null;
    blue_registration_id: string | null;
  };
  const pools = await json<Array<{ matches?: PwmMatch[] }>>(
    await ok(
      await request.get(api(`tournaments/${tournamentId}/pools-with-matches`)),
      'load pools-with-matches',
    ),
  );
  const match = pools
    .flatMap((p) => p.matches ?? [])
    .find((m) => m.red_registration_id && m.blue_registration_id && m.status !== 'completed');
  if (!match) throw new Error('no playable pool match was generated');

  await ok(
    await request.patch(api(`matches/${match.id}/status`), { data: { status: 'running' } }),
    'start match',
  );

  // ── Helpers bound to this match ─────────────────────────────────────────────
  const serverExchangeCount = async (): Promise<number> => {
    const res = await request.get(api(`matches/${match.id}/exchanges`));
    if (!res.ok()) return -1;
    const list = await json<unknown[]>(res);
    return Array.isArray(list) ? list.length : -1;
  };

  const outboxCount = (p: Page): Promise<number> =>
    p.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('myclash-scoring');
          open.onerror = () => resolve(-1);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('outbox')) {
              db.close();
              resolve(0);
              return;
            }
            const countReq = db.transaction('outbox', 'readonly').objectStore('outbox').count();
            countReq.onsuccess = () => {
              resolve(countReq.result);
              db.close();
            };
            countReq.onerror = () => {
              db.close();
              resolve(-1);
            };
          };
        }),
    );

  const bar = page.getByTestId('network-bar');
  const cleanHit = page.getByTestId('clean-hit-button').first();

  // ── Open the pad ────────────────────────────────────────────────────────────
  await page.goto(`${scoringBase}/matches/${match.id}`);
  await expect(bar).toHaveAttribute('data-network', 'online', { timeout: 30_000 });
  await expect(cleanHit).toBeEnabled({ timeout: 30_000 });

  // ── The seed reached the pad: custom targets, NOT the federal defaults ───────
  // Head=3 / Body=1 → +3 / +1 clean buttons; the federal pad would be +2 / +1.
  await expect(
    page.getByTestId('clean-hit-button').filter({ hasText: '+3' }).first(),
  ).toBeVisible();
  await expect(
    page.getByTestId('clean-hit-button').filter({ hasText: '+1' }).first(),
  ).toBeVisible();
  // A +2 button would mean the pad fell back to the federal default — it must not.
  await expect(page.getByTestId('clean-hit-button').filter({ hasText: '+2' })).toHaveCount(0);

  // ── 1) ONLINE: record one hit, it reaches the server ────────────────────────
  expect(await serverExchangeCount()).toBe(0);
  await cleanHit.click();
  await expect.poll(serverExchangeCount, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => outboxCount(page), { timeout: 10_000 }).toBe(0);

  // ── 2) OFFLINE: record one hit, it queues durably (not lost) ─────────────────
  await context.setOffline(true);
  await expect(bar).toHaveAttribute('data-network', 'offline', { timeout: 15_000 });
  await cleanHit.click();
  await expect.poll(() => outboxCount(page), { timeout: 15_000 }).toBe(1);
  await expect(bar).toHaveAttribute('data-pending', '1', { timeout: 15_000 });
  expect(await serverExchangeCount()).toBe(1);

  // ── 3) RECONNECT: the queue auto-drains and the server has both ──────────────
  await context.setOffline(false);
  await expect(bar).toHaveAttribute('data-network', 'online', { timeout: 15_000 });
  await expect.poll(() => outboxCount(page), { timeout: 20_000 }).toBe(0);
  await expect(bar).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  await expect.poll(serverExchangeCount, { timeout: 20_000 }).toBe(2);
});
