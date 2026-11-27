import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { runContext } from './_context';
import { apiFor } from './_api';
import { openForScoring } from './_bracket';
import { aMatch, nextSequence } from './_pad';

/**
 * Protests, end to end (run with `E2E_PROTESTS=1`).
 *
 * A protest is its own entry of a Match (`match_protests`, 0276), counted per
 * fighter against an optional per-Tournament limit; past the limit the pad
 * offers a penalty. The a11y suite covers the pad's side against stubs. This
 * spec runs the real chain once:
 *
 *   1. the organiser sets the limit and the offered penalty on the Tournament's
 *      Display settings, in the admin app, and the server stores both;
 *   2. the API refuses a protest on a bout that has not started and one by a
 *      person who is not in the Match, saves one past the limit (the server
 *      never enforces it: the limit is the pad's), and voids one exactly once;
 *   3. the pad, opened on that Match, shows the count against the limit and,
 *      on the tap that passes it, offers the chosen penalty;
 *   4. the TV display shows the same count, and the public Match history shows
 *      each protest as a row with no number, the voided one left out.
 *
 * Not covered: the referee statistics' protest count. It counts only bouts
 * with a match-scope head referee, which only auto-assign writes, and only for
 * bracket and Swiss bouts — a fixture of its own.
 *
 * ── Why it builds its own Event ──────────────────────────────────────────────
 *
 * Steps 3 and 4 read the Match on the public site, which hides a draft or
 * `test` Event. As in `15`, a `club` Event is public, silent on publish, and
 * hard-deletable with results. It is deleted with `E2E_CLEANUP`, and otherwise
 * flipped to `test` so it leaves the public site.
 */
const PROTESTS = ['1', 'true', 'yes'].includes((process.env.E2E_PROTESTS ?? '').toLowerCase());
const CLEANUP = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());

const publicBase = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(/\/$/, '');

/** Per fighter, per Match. The third protest is the first one past it. */
const LIMIT = 2;

interface PenaltyEntry {
  ref_number: string;
  short_name: string;
}

interface ProtestRow {
  id: string;
  registration_id: string;
  voided: boolean;
}

const createdEventIds: string[] = [];

test.describe('protests', () => {
  test.skip(!PROTESTS, 'set E2E_PROTESTS=1 to drive protests from the settings to the TV');

  test.afterAll(async ({ playwright }) => {
    const { baseURL, orgSlug } = runContext();
    const ctx = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    const api = apiFor(ctx);
    for (const id of createdEventIds) {
      if (CLEANUP) {
        const res = await api.delete(`events/${id}?mode=hard`);
        if (!res.ok()) console.warn(`[e2e] could not delete protest event ${id}: ${res.status()}`);
        continue;
      }
      const hidden = await api.patch(`events/${id}`, { data: { eventKind: 'test' } });
      if (!hidden.ok())
        console.warn(`[e2e] could not hide protest event ${id}: ${hidden.status()}`);
      console.log(`[e2e] protest event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
    }
    await ctx.dispose();
  });

  test('a limit set in the admin app is counted on the pad, the TV and the history', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { orgId, orgSlug, baseURL } = runContext();
    const token = Date.now().toString(36);

    // ── A public Event with one playable Match ─────────────────────────────
    const eventSlug = `e2e-protests-${token}`;
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) protests — ${token}`,
          slug: eventSlug,
          startDate: '2099-05-01',
          endDate: '2099-05-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'club',
        },
      }),
    );
    createdEventIds.push(event.id);
    const match = await aMatch(api, 'protests', { eventId: event.id });
    await api.ok(await api.post(`events/${event.id}/publish`, { data: {} }));
    await api.ok(await api.post(`tournaments/${match.tournamentId}/publish`, { data: {} }));

    // The penalty to offer, from the Tournament's own list. Read, not
    // hard-coded: migrations reshape the built-in list. Ref 8 ("Contestation
    // abusive") is the one written for this; any listed ref proves the chain.
    const penalties = await api.json<{ penalty_ruleset_entries?: PenaltyEntry[] }>(
      await api.get(`tournaments/${match.tournamentId}/penalty-ruleset`),
    );
    const entries = penalties.penalty_ruleset_entries ?? [];
    const offered = entries.find((e) => e.ref_number === '8') ?? entries[0];
    expect(offered, 'the Tournament needs a penalty list to offer from').toBeDefined();

    // ── 1. The organiser sets the limit and the penalty ────────────────────
    // Before the bout starts, as an organiser would; the Display settings are
    // not under the started-Tournament lock, but nothing here leans on that.
    await page.goto(
      `${baseURL}/org/${orgSlug}/events/${event.id}/tournaments/${match.tournamentId}/settings#display`,
    );
    const limitInput = page.getByLabel('Protest limit', { exact: true });
    await expect(limitInput).toBeVisible({ timeout: 30_000 });
    await limitInput.fill(String(LIMIT));
    // Not `exact`: the select sits inside its <label>, so its accessible name also
    // carries the chosen option's text ("Penalty offered past the limit None").
    await page.getByLabel('Penalty offered past the limit').selectOption(offered!.ref_number);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect
      .poll(
        async () =>
          (
            await api.json<{
              scoring_config_json?: { display?: { protests?: unknown } } | null;
            }>(await api.get(`tournaments/${match.tournamentId}`))
          ).scoring_config_json?.display?.protests,
        { timeout: 20_000, message: 'the Display tab must store the limit and the penalty' },
      )
      .toEqual({ limit: LIMIT, offerPenaltyRef: offered!.ref_number });

    // ── 2. What the API accepts and refuses ───────────────────────────────
    const protest = (registrationId: string) =>
      api.post(`matches/${match.matchId}/protests`, {
        data: {
          clientUuid: randomUUID(),
          sequence: nextSequence(),
          registrationId,
          occurredAt: new Date().toISOString(),
        },
      });

    const tooEarly = await protest(match.redRegistrationId);
    expect(tooEarly.status(), 'a bout that has not started takes no protest').toBe(409);
    expect(await tooEarly.text()).toContain('bout_not_started');

    await openForScoring(api, match.matchId);

    const stranger = await protest('00000000-0000-4000-8000-0000000000ab');
    expect(stranger.status(), 'only one of the two fighters may protest').toBe(400);

    // Two by red — up to the limit — and one by blue, which is then voided.
    for (let i = 0; i < LIMIT; i++) {
      expect((await protest(match.redRegistrationId)).status()).toBe(201);
    }
    const blue = await api.json<ProtestRow>(await protest(match.blueRegistrationId));
    const voided = await api.json<ProtestRow>(
      await api.patch(`match-protests/${blue.id}/void`, { data: { reason: 'E2E: entered twice' } }),
    );
    expect(voided.voided, 'the void must stick').toBe(true);
    const again = await api.patch(`match-protests/${blue.id}/void`, { data: {} });
    expect(again.status(), 'a protest is voided once').toBe(400);

    // ── 3. The pad counts against the limit, and offers the penalty ───────
    await page.goto(`${staffBase(baseURL)}/matches/${match.matchId}`);
    const redColumn = page.locator('[data-testid="scoring-column"][data-side="red"]');
    const redChip = redColumn.getByTestId('protest-chip');
    const blueChip = page.locator(
      '[data-testid="scoring-column"][data-side="blue"] [data-testid="protest-chip"]',
    );
    await expect(redChip).toHaveText(`${LIMIT}/${LIMIT}`, { timeout: 30_000 });
    // The voided one does not count.
    await expect(blueChip).toHaveText(`0/${LIMIT}`);
    // The offer is decided AT the tap, from the penalty list the pad holds then.
    // The list loads on its own read, after the protests; a tap before it lands
    // records the protest and offers nothing. The column listing the chosen
    // penalty is the settle signal.
    await expect(redColumn.getByText(offered!.short_name).first()).toBeVisible({ timeout: 30_000 });

    // The tap that passes the limit records the protest, then offers the card.
    await redChip.click();
    const offer = page.getByRole('dialog');
    await expect(offer).toContainText('Protest limit passed');
    await expect(offer).toContainText(offered!.short_name);
    await offer.getByRole('button', { name: 'Cancel' }).click();
    await expect(redChip).toHaveText(`${LIMIT + 1}/${LIMIT}`);

    const live = async (): Promise<ProtestRow[]> =>
      (await api.json<ProtestRow[]>(await api.get(`matches/${match.matchId}/protests`))).filter(
        (p) => !p.voided,
      );
    await expect
      .poll(async () => (await live()).length, {
        timeout: 20_000,
        message: "the pad's protest must reach the server",
      })
      .toBe(LIMIT + 1);
    // The offer was declined, so no card was given.
    const cards = await api.json<unknown[]>(await api.get(`matches/${match.matchId}/penalties`));
    expect(cards, 'a declined offer gives no card').toEqual([]);

    // ── 4. The TV and the public history read the same protests ───────────
    await page.goto(`${publicBase}/e/${eventSlug}/match/${match.matchId}/display`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(`${LIMIT + 1}/${LIMIT}`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(`0/${LIMIT}`, { exact: true })).toBeVisible();

    await page.goto(`${publicBase}/e/${eventSlug}/match/${match.matchId}`, {
      waitUntil: 'domcontentloaded',
    });
    const history = page.getByRole('list', { name: 'Exchange history' });
    // One Fighter's protests, each named by its count: "Protest 1" … "Protest 3".
    for (let n = 1; n <= LIMIT + 1; n++) {
      await expect(history.getByText(`Protest ${n}`, { exact: true })).toHaveCount(1, {
        timeout: 30_000,
      });
    }
    // A protest is a row of the history with no #N: that numbering belongs
    // to hits and cards, and this bout has none.
    await expect(history.locator('li[data-event-number]')).toHaveCount(0);
  });
});

/** Where the staff app is served: its own host, or the admin host's `/staff` mount. */
const staffBase = (baseURL: string): string =>
  (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/, '');
