import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { runContext } from './_context';

/**
 * Offline scoring durability (web-scoring PWA) — drives the real scoring pad and
 * proves the outbox + SyncEngine wiring on the critical scoring path.
 *
 * Seeds a self-contained 2-fighter tournament in the shared throwaway event via
 * API (lice → 2 persons → tournament → register → generate one pool → the single
 * pool match), starts that match, then opens the pad and:
 *   1. records ONE clean hit while ONLINE — asserts it reaches the server
 *      (proves the rewired online path still persists exchanges), then
 *   2. goes OFFLINE (`context.setOffline`), records another clean hit — asserts
 *      the network bar flips to offline with pending count 1 AND the IndexedDB
 *      `myclash-scoring` outbox holds exactly 1 queued exchange (nothing lost),
 *      then
 *   3. comes back ONLINE — asserts the outbox drains to 0 and the server now
 *      returns BOTH exchanges (client_uuid idempotency; auto-drain on reconnect).
 *
 * The pad is served same-origin via the admin `/scoring/*` proxy by default
 * (trusted cert, the path organizers actually use); set `E2E_SCORING_URL` to the
 * canonical scoring subdomain to exercise that host instead. The `.myclash.fr`
 * session cookie authenticates either origin.
 *
 * Event-scoped, so global-teardown's hard-delete cleans it up.
 */
test('offline scoring queues an exchange and auto-syncs on reconnect', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  const { eventId, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  // The pad lives in the web-scoring app; reach it same-origin through the admin
  // `/scoring/*` proxy (default) or via an explicit scoring host override.
  const scoringBase = (process.env.E2E_SCORING_URL ?? `${baseURL}/scoring`).replace(/\/$/, '');

  const ok = async (res: APIResponse, label: string): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
    return res;
  };
  const json = async <T>(res: APIResponse): Promise<T> => (await res.json()) as T;

  // ── Seed a 2-fighter pool match (API) ───────────────────────────────────────
  await ok(
    await request.post(api(`events/${eventId}/lices`), { data: { name: `OS Lice ${tok}` } }),
    'create lice',
  );

  const createPerson = async (given: string): Promise<string> => {
    const res = await ok(
      await request.post(api(`events/${eventId}/persons`), {
        data: { givenName: given, familyName: `Os${tok}` },
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
          data: { name: `OS Cup ${tok}`, slug: `os-${tok}` },
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

  // Find the single pool match (both fighters present, not yet completed).
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

  // Start the match so the pad enables scoring (running + clock stopped → canScore).
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

  // Count rows in the IndexedDB outbox the SyncEngine drains (0 if the store
  // isn't there yet). Runs inside the page so it sees the pad's own DB.
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
  // Scoring is enabled (match running, clock stopped) → the clean-hit button is tappable.
  await expect(cleanHit).toBeEnabled({ timeout: 30_000 });

  // ── 1) ONLINE: record one hit, it reaches the server ────────────────────────
  expect(await serverExchangeCount()).toBe(0);
  await cleanHit.click();
  await expect.poll(serverExchangeCount, { timeout: 20_000 }).toBe(1);
  // The online write drains immediately — nothing left queued locally.
  await expect.poll(() => outboxCount(page), { timeout: 10_000 }).toBe(0);

  // ── 2) OFFLINE: record one hit, it queues durably (not lost) ─────────────────
  await context.setOffline(true);
  await expect(bar).toHaveAttribute('data-network', 'offline', { timeout: 15_000 });
  await cleanHit.click();
  // The exchange is captured in the outbox and surfaced as a pending count in the bar.
  await expect.poll(() => outboxCount(page), { timeout: 15_000 }).toBe(1);
  await expect(bar).toHaveAttribute('data-pending', '1', { timeout: 15_000 });
  // Still offline → the server has NOT received the second exchange yet.
  expect(await serverExchangeCount()).toBe(1);

  // ── 3) RECONNECT: the queue auto-drains and the server has both ──────────────
  await context.setOffline(false);
  await expect(bar).toHaveAttribute('data-network', 'online', { timeout: 15_000 });
  await expect.poll(() => outboxCount(page), { timeout: 20_000 }).toBe(0);
  await expect(bar).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  await expect.poll(serverExchangeCount, { timeout: 20_000 }).toBe(2);
});
