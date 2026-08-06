import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, createBracketTournament, ensureRoster, type Api } from './_bracket';

/**
 * The live control room, and whether its realtime is actually alive.
 *
 * `live-board-merge.test.ts` and `live-board-state.test.ts` already cover the
 * merge and the health derivation as pure functions. What no test has ever
 * asked is whether a channel SUBSCRIBES — and that is the failure this project
 * keeps meeting: the realtime tenant taken from the Host's first label, and an
 * unpublished table in a `postgres_changes` binding, both of which leave every
 * channel in a permanent CHANNEL_ERROR that nothing surfaces.
 *
 * It is silent by construction. `useLiveBoard` runs a 7 s structural poll that
 * is the source of truth, and `LiceRealtime`'s own fallback is deliberately a
 * no-op because of it. So a board with every socket dead still fills in, still
 * updates, still looks correct — roughly seven seconds late, which nobody
 * notices in a test and everybody notices at a venue.
 *
 * **That is why the proof here is the console line, not the score.** Asserting
 * that the board eventually shows 5–3 passes identically whether realtime
 * delivered it or the poll did, so such an assertion would be worth nothing.
 * `useRealtimeWithFallback` logs `[realtime] connected: <channel>` on SUBSCRIBED
 * and `[realtime] dropped (<status>): <channel>` on CHANNEL_ERROR / TIMED_OUT /
 * CLOSED (apps/web-admin/src/lib/supabase-browser.ts), and those two lines are
 * the only signal that tells the two apart. web-admin's next.config sets no
 * `removeConsole`, so they survive the production build.
 *
 * Websocket opens are recorded too — not as an assertion, but so a failure can
 * say WHICH layer went: no socket at all points at the transport (a bad cert
 * chain, a wrong tenant, Traefik), while a socket that opened and a channel
 * that never subscribed points at the binding or the publication.
 */

const LIVE_BOARD = ['1', 'true', 'yes'].includes((process.env.E2E_LIVE_BOARD ?? '').toLowerCase());

interface PoolWithMatches {
  poolId?: string;
  id?: string;
  pool_id?: string;
  matches?: Array<{ id: string; status: string }>;
}

interface BoardRow {
  lice: { id: string; name: string };
  currentMatch: { id: string; redScore: number; blueScore: number } | null;
}

/**
 * Land `count` single-point clean hits for one side, LEAVING THE BOUT UNFINISHED.
 *
 * Deliberately not `scoreMatch` from `_bracket.ts`, which plays to the point cap
 * and lets the engine complete the match: the board queries
 * `status in (running, paused, scheduled)`, so a completed bout leaves the piste
 * entirely and the row falls back to Idle. A control room shows what is on now.
 * An unfinished bout is also the only state where the score cell patching this
 * spec exists to check is worth anything.
 */
async function landCleanHits(
  api: Api,
  matchId: string,
  color: 'red' | 'blue',
  count: number,
): Promise<void> {
  for (let sequence = 1; sequence <= count; sequence += 1) {
    await api.ok(
      await api.post(`matches/${matchId}/exchanges`, {
        data: {
          clientUuid: randomUUID(),
          sequence,
          type: 'clean',
          occurredAt: new Date().toISOString(),
          clockTimeMs: sequence * 15_000,
          firstStrikerColor: color,
          firstStrikeValue: 1,
        },
      }),
    );
  }
}

test.describe('live control room', () => {
  test.skip(!LIVE_BOARD, 'set E2E_LIVE_BOARD=1 to drive the live board and its realtime channels');

  test('each piste subscribes, and a bout scored elsewhere patches only that piste', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId, orgSlug } = runContext();
    const token = Date.now().toString(36);

    // A platform-wide `disable_realtime` makes every assertion below fail for a
    // reason that is a decision, not a defect. Read the same snapshot the hook
    // reads and say so plainly instead.
    const flags = await api.json<{ realtimeDisabled: boolean }>(
      await api.get('public/feature-flags'),
    );
    test.skip(
      flags.realtimeDisabled,
      'disable_realtime is ON for this environment — the board is polling by design',
    );

    // ── Two pistes, one bout each ────────────────────────────────────────────
    // The shared event already carries other specs' lices, so everything below
    // is scoped by these two names and ids; extra rows on the board are fine.
    const liceAName = `Board A ${token}`;
    const liceBName = `Board B ${token}`;
    const liceA = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/lices`, { data: { name: liceAName } }),
    );
    const liceB = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/lices`, { data: { name: liceBName } }),
    );

    const fighters = await ensureRoster(api, eventId, [
      { givenName: 'Board', familyName: 'One' },
      { givenName: 'Board', familyName: 'Two' },
      { givenName: 'Board', familyName: 'Three' },
      { givenName: 'Board', familyName: 'Four' },
    ]);
    // Reused for the point cap it pins (5, not the default 10) — `scoreMatch`
    // needs to know exactly how many points end the bout.
    const tournament = await createBracketTournament(api, eventId, {
      name: `Live Board ${token}`,
      slug: `live-board-${token}`,
      fighters,
    });
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 2 } }),
    );

    // Four fighters over two pools is one bout each, which is what makes the
    // isolation assertion below readable: one piste moves, the other cannot.
    const pools = await api.json<PoolWithMatches[]>(
      await api.get(`tournaments/${tournament.id}/pools-with-matches`),
    );
    const poolIdOf = (p: PoolWithMatches) => (p.poolId ?? p.id ?? p.pool_id) as string;
    expect(pools.length, 'two pools, one bout each').toBe(2);
    const matchA = pools[0].matches?.[0]?.id;
    const matchB = pools[1].matches?.[0]?.id;
    expect(matchA && matchB, 'both pools must hold a bout').toBeTruthy();

    await api.ok(await api.put(`pools/${poolIdOf(pools[0])}/lice`, { data: { liceId: liceA.id } }));
    await api.ok(await api.put(`pools/${poolIdOf(pools[1])}/lice`, { data: { liceId: liceB.id } }));

    // Precondition, asserted rather than assumed: the API's own board must
    // already show a bout on each piste. If it does not, the browser half below
    // would fail for a data reason while pointing at the realtime code.
    const boardRowFor = async (liceId: string): Promise<BoardRow | undefined> => {
      const board = await api.json<{ rows: BoardRow[] }>(
        await api.get(`events/${eventId}/live-board`),
      );
      return board.rows.find((r) => r.lice.id === liceId);
    };
    await expect
      .poll(async () => (await boardRowFor(liceA.id))?.currentMatch?.id, { timeout: 30_000 })
      .toBe(matchA);
    expect((await boardRowFor(liceB.id))?.currentMatch?.id, 'piste B holds its own bout').toBe(
      matchB,
    );

    // ── The browser: what the socket did ─────────────────────────────────────
    const realtimeLogs: string[] = [];
    const socketUrls: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[realtime]')) realtimeLogs.push(text);
    });
    page.on('websocket', (ws) => socketUrls.push(ws.url()));

    await page.goto(`/org/${orgSlug}/events/${eventId}/live`);
    // Rows carry data-testid="live-row" + data-lice-name. Selecting on those
    // rather than on `li:visible` + text: the old selector matched any list
    // item containing the name, so it was load-bearing on markup with no stable
    // hook — and the expansion has since reshaped that markup.
    const row = (liceName: string) =>
      page.locator(`[data-testid="live-row"][data-lice-name="${liceName}"]:visible`);

    // The subscribers are rendered from the rows, so the channels only exist
    // once the first poll has landed and the pistes are on screen.
    await expect(row(liceAName)).toBeVisible({ timeout: 30_000 });

    const connected = (liceId: string) =>
      realtimeLogs.filter((l) => l.includes(`connected: live-board-lice:${liceId}`));
    const dropped = (liceId: string) =>
      realtimeLogs.filter((l) => l.includes('dropped') && l.includes(`live-board-lice:${liceId}`));

    for (const [name, liceId] of [
      [liceAName, liceA.id],
      [liceBName, liceB.id],
    ] as const) {
      await expect
        .poll(() => connected(liceId).length, {
          timeout: 45_000,
          message:
            `${name}: the realtime channel never reached SUBSCRIBED. ` +
            `Websockets opened: ${socketUrls.length ? socketUrls.join(', ') : 'NONE'} — ` +
            `none means the transport is the problem (cert chain, realtime tenant, proxy); ` +
            `one that opened means the channel itself was refused (binding vs publication). ` +
            `Lines seen: ${realtimeLogs.join(' | ') || '(none)'}`,
        })
        .toBeGreaterThan(0);
      expect(dropped(liceId), `${name}: the channel dropped after connecting`).toEqual([]);
    }

    // ── The merge: the piste that was scored, and only it ────────────────────
    await landCleanHits(api, matchA as string, 'red', 2);

    await expect(row(liceAName), 'the scored piste must show the new score').toContainText('2–0', {
      timeout: 30_000,
    });
    await expect(row(liceBName), 'a piste nobody touched must not move').toContainText('0–0');

    // ── The expansion: opens in place, and does not navigate ─────────────────
    const boardUrl = page.url();
    const toggle = row(liceAName).getByRole('button', { expanded: false });
    await toggle.click();

    await expect(row(liceAName).getByRole('button', { expanded: true })).toBeVisible();
    expect(page.url(), 'expanding a row must NOT navigate away from the board').toBe(boardUrl);

    // The exchange feed is the reason to expand rather than read. Two clean
    // hits landed above, so the timeline has something to show.
    await expect(row(liceAName), 'the expansion shows the exchange feed').toContainText(
      /Exchanges|Échanges/,
      { timeout: 30_000 },
    );

    // Score ↗ carries a return leg back to the board — losing the board is the
    // failure this whole design avoids. It must point at the MATCH route, never
    // at /scoring/lices/{id}, which 401s an org admin into /login.
    const scoreLink = row(liceAName).locator(`a[href*="/scoring/matches/${matchA}"]`);
    await expect(scoreLink, 'the expansion offers Score ↗ for the running bout').toHaveCount(1);
    const scoreHref = await scoreLink.getAttribute('href');
    expect(scoreHref, 'Score ↗ must return to the board').toContain('return=');
    expect(
      await row(liceAName).locator('a[href*="/scoring/lices/"]').count(),
      'the board must never link /scoring/lices — it is mc_staff-cookie only',
    ).toBe(0);

    // Collapsing is the same control.
    await row(liceAName).getByRole('button', { expanded: true }).click();
    await expect(row(liceAName).getByRole('button', { expanded: false })).toBeVisible();

    // ── Timing: an overdue bout must say so ──────────────────────────────────
    // Piste B's bout is still unstarted, so back-dating its slot past the late
    // threshold (10 min) produces the "nobody has picked it up" case. Reusing
    // this run's fixtures rather than building a second tournament: the shared
    // event is already large, and the assertion needs one scheduled bout.
    const overdue = new Date(Date.now() - 45 * 60_000).toISOString();
    await api.ok(
      await api.patch(`matches/${matchB}/schedule`, {
        data: { liceId: liceB.id, scheduledAt: overdue },
      }),
    );

    // Asserting the TIMING CELL, not the health dot. No scorer is assigned to
    // these pistes, so deriveHealthState resolves them to `no_scorer` — which
    // is correct and outranks `late`, because an unmanned piste is the cause of
    // the missing signals rather than a symptom to report around it. The
    // overdue readout is independent of that and is what this covers; the
    // `late` state itself is pinned in live-board-state.test.ts.
    await expect(
      row(liceBName),
      'an overdue, unstarted bout must show how long it has been due',
    ).toContainText(/due .* ago|attendu il y a/, { timeout: 30_000 });
  });
});
