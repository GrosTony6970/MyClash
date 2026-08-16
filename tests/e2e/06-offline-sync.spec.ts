import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { runContext } from './_context';

/**
 * Offline scoring durability (web-staff PWA) — drives the real scoring pad and
 * proves the outbox + SyncEngine wiring on the critical scoring path.
 *
 * Seeds a self-contained 2-fighter tournament in the shared throwaway event via
 * API (lice → 2 persons → tournament → register → generate one pool → the single
 * pool match), starts that match, then opens the pad and:
 *   1. records ONE clean hit while ONLINE — asserts it reaches the server
 *      (proves the rewired online path still persists exchanges), then
 *   2. goes OFFLINE (`context.setOffline`), records another clean hit — asserts
 *      the network bar flips to offline with pending count 1 AND the IndexedDB
 *      `myclash-staff` outbox holds exactly 1 queued exchange (nothing lost),
 *      then
 *   3. comes back ONLINE — asserts the outbox drains to 0 and the server now
 *      returns BOTH exchanges (client_uuid idempotency; auto-drain on reconnect).
 *
 * The pad is served same-origin via the admin `/scoring/*` proxy by default
 * (trusted cert, the path organizers actually use); set `E2E_STAFF_URL` to the
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
  // The pad lives in the web-staff app; reach it same-origin through the admin
  // `/scoring/*` proxy (default) or via an explicit scoring host override.
  const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/, '');

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
          const open = indexedDB.open('myclash-staff');
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
  await page.goto(`${staffBase}/matches/${match.id}`);
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
  // …and the referee can still score the NEXT one. Everything above passes
  // just as happily when the pad has replaced itself with "match unavailable",
  // because the network bar renders outside that guard — which is exactly what
  // it used to do. The service worker resolves a synthetic 503 rather than
  // throwing, the page read that as "this match is gone", and scoring a hit
  // re-runs the fetch that clears it. Assert the scoring surface survives.
  await expect(cleanHit).toBeEnabled({ timeout: 15_000 });

  // ── 2b) OFFLINE: a card the referee issues moves the score ───────────────────
  /**
   * A queued card used to be worth nothing on screen: the pad did not read the
   * penalty ruleset's per-card point columns, so the row said "not counted yet"
   * and the numeral did not move.
   *
   * Only a RED card moves anything under the built-in rulebook — migration 0054
   * seeds yellow and black at 0 and red at −1 — so the entry is chosen from the
   * ruleset the server is actually serving rather than hard-coded. A rulebook
   * revision must not silently turn this into an assertion about zero.
   *
   * The column picker is the only offline path: the corrections drawer's direct
   * card POSTs straight out instead of going through the outbox.
   */
  type WireEntry = { id: string; group_number: number; ref_number: number; sanctions: string[] };
  const ruleset = await json<{ penalty_ruleset_entries?: WireEntry[] } | null>(
    await ok(await request.get(api(`matches/${match.id}/penalty-ruleset`)), 'load penalty ruleset'),
  );
  // The picker sorts by (group, ref) and renders the first 30 only, so an entry
  // past that window has no button to click.
  const redFirst = [...(ruleset?.penalty_ruleset_entries ?? [])]
    .sort((a, b) => a.group_number - b.group_number || a.ref_number - b.ref_number)
    .slice(0, 30)
    .find((e) => e.sanctions?.[0] === 'red');

  if (!redFirst) {
    // Skipped loudly rather than passed quietly: with no first-offence red in
    // the picker there is no card whose points are visible, and asserting on a
    // zero-point yellow would prove nothing about pricing.
    test.info().annotations.push({
      type: 'skipped-assertion',
      description: 'no first-offence red card among the entries the picker renders',
    });
  } else {
    const redColumn = page.locator('[data-testid="scoring-column"][data-side="red"]');
    const provisional = redColumn.getByTestId('provisional-score');
    // Step 2 already queued a red clean hit (+2), so red's delta starts at 2.
    await expect(provisional).toHaveAttribute('data-provisional-delta', '2', { timeout: 15_000 });

    await redColumn
      .locator(`[data-testid="penalty-entry-button"][data-entry-id="${redFirst.id}"]`)
      .click();

    // −1 for the card, on top of the +2 already queued. The card is in the
    // number, so it is reported as included and NOT as "not counted yet".
    await expect(provisional).toHaveAttribute('data-provisional-delta', '1', { timeout: 15_000 });
    await expect(provisional).toHaveAttribute('data-queued-cards', '1');
    await expect(provisional).toHaveAttribute('data-unpriced-cards', '0');
    // Still offline: the server has seen neither the hit nor the card.
    expect(await serverExchangeCount()).toBe(1);
    await expect(bar).toHaveAttribute('data-pending', '2', { timeout: 15_000 });
  }

  // ── 3) RECONNECT: the queue auto-drains and the server has both ──────────────
  await context.setOffline(false);
  await expect(bar).toHaveAttribute('data-network', 'online', { timeout: 15_000 });
  await expect.poll(() => outboxCount(page), { timeout: 20_000 }).toBe(0);
  await expect(bar).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  await expect.poll(serverExchangeCount, { timeout: 20_000 }).toBe(2);
});
