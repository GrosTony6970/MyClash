import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_bracket';
import { buildSwissTournament, playSwiss, readSwissStandings } from './_swiss';

/**
 * The Swiss admin route and public tab, RENDERED (run with E2E_SWISS=1).
 *
 * `22-swiss.spec.ts` drives the whole format through the API and never opens a
 * page. Between them, Docker `next build` proves the components compile and
 * `t-key-references` proves every static key resolves — but nothing proves they
 * render: a null deref on a field that is null in practice, a panel that stays
 * empty because its filter matched nothing, or a dynamically-composed `t()` key
 * the sweep cannot see would all ship silently. That is what this covers.
 *
 * ── Why this builds its own event ────────────────────────────────────────────
 *
 * The shared throwaway event is `standard`, and publishing a standard event
 * ANNOUNCES it to the organisation's followers (`announcesOnPublish`) — a test
 * run must never do that to real people. `event_kind: 'club'` is the one kind
 * that is fully public, silent on publish, and hard-deletable with results
 * recorded, so this spec makes its own and tears it down. Same reasoning, and
 * the same shape, as `15-public-site.spec.ts`.
 *
 * ── Why it plays BEFORE it publishes ─────────────────────────────────────────
 *
 * `swiss_round_published` fires from the commit path on every round, gated on
 * the tournament being published. Publishing first and then playing would fan
 * that out four times. The roster is `ensureRoster`, so every entrant is
 * unclaimed and nothing could actually be delivered — but that is a property of
 * the fixture, not of the code, and it is one edit away from being false.
 * **Never put a claimed person in this fixture.**
 */
const SWISS = ['1', 'true', 'yes'].includes((process.env.E2E_SWISS ?? '').toLowerCase());

/** The deployed web-public host. Sibling of `E2E_PUBLIC_URL` in `15`. */
const publicBase = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(/\/$/, '');

/** Odd, so the bye renders too — it is a distinct row the public tab draws. */
const FIELD = 9;
const ROUNDS = 3;

interface Fixture {
  eventId: string;
  eventSlug: string;
  orgSlug: string;
  tournamentId: string;
  tournamentSlug: string;
  /**
   * Standings order after the phase was played, top first.
   *
   * The names come from the STANDINGS rather than from a roster this spec
   * built: `buildSwissTournament` provisions its own `Seed NN` field, so a
   * locally-named roster would be dead code and every assertion would hunt for
   * a name the page was never going to show.
   */
  ranked: string[];
}
let fixture: Fixture;

/** Navigate and wait for the app shell, not just the HTML document. */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
}

/**
 * The public tab panel for `key`.
 *
 * Every panel stays in the DOM and the inactive ones carry `hidden`, so a
 * page-wide text lookup happily matches a name on a tab nobody is looking at.
 * The admin route needs no equivalent — it mounts only the active tab.
 */
const panel = (page: Page, key: string) => page.locator(`#panel-${key}`);

/**
 * Any untranslated key left on screen.
 *
 * `t-key-references` proves every STATIC key resolves; it cannot see
 * `` t(`organizer.swiss.tiebreak.${key}`) ``. A missing one renders as the key
 * itself, which is exactly what this looks for.
 */
async function expectNoRawKeys(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()) ?? '';
  const raw = body.match(/\b(?:organizer|publicApp)\.[a-zA-Z0-9.]+/g) ?? [];
  expect(raw, `untranslated i18n key(s) rendered on ${page.url()}`).toEqual([]);
}

test.describe(SWISS ? 'Swiss UI' : 'Swiss UI (set E2E_SWISS=1 to run)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!SWISS, 'Publishes an event and scores real matches; opt in with E2E_SWISS=1.');

  test('the admin route renders every tab against a played phase', async ({ page, request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { orgId, orgSlug, baseURL } = runContext();
    const token = Date.now().toString(36);

    const eventSlug = `e2e-swiss-${token}`;
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) swiss — ${token}`,
          slug: eventSlug,
          startDate: '2099-04-01',
          endDate: '2099-04-02',
          city: 'Testville',
          country: 'FR',
          // Public, silent on publish, disposable. See the header.
          eventKind: 'club',
        },
      }),
    );

    const { tournament, seeds } = await buildSwissTournament(api, event.id, {
      key: `ui-${token}`,
      count: FIELD,
      roundCount: ROUNDS,
    });

    // Played FIRST, while the tournament is still draft — see the header.
    const result = await playSwiss(api, tournament.id, seeds);
    expect(result.stallReport, result.stallReport).toBe('');
    const standings = await readSwissStandings(api, tournament.id);
    expect(standings.rows).toHaveLength(FIELD);

    fixture = {
      eventId: event.id,
      eventSlug,
      orgSlug,
      tournamentId: tournament.id,
      tournamentSlug: (await tournamentSlugOf(api, tournament.id)) ?? '',
      ranked: standings.rows.map((row) => row.displayName),
    };

    // ── The admin route, tab by tab ────────────────────────────────────────
    const swissPath = `${baseURL}/org/${orgSlug}/events/${event.id}/swiss`;
    const leader = fixture.ranked[0]!;

    await open(page, `${swissPath}#configure`);
    // The round count the phase was pinned to, and the coverage line: this
    // roster has no HEMA ids, so 0 of 9 rated is the honest answer and the line
    // must still render rather than vanish.
    await expect(page.getByText(`${FIELD} fighters`, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expectNoRawKeys(page);

    await open(page, `${swissPath}#rounds`);
    // Real names on the pairing cards — the projection returned registration ids
    // only until slice 8, which would render as blanks here. The leader is in
    // round 1 whatever the draw did, as a pairing or as the bye.
    await expect(page.getByText(leader, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('SW-R1-M1', { exact: false }).first()).toBeVisible();
    await expectNoRawKeys(page);

    await open(page, `${swissPath}#standings`);
    await expect(page.getByText(leader, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    // The Swiss-only column the chain ranks on. Rendered from the API's own
    // `columns`, so a missing label here means the table dropped it.
    await expect(page.getByText('Buchholz', { exact: false }).first()).toBeVisible();
    await expectNoRawKeys(page);

    await open(page, `${swissPath}#referees`);
    // No referees are assigned, so this is the empty state — still a real render
    // of the tab, and the one most likely to throw on an absent board.
    await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
    await expectNoRawKeys(page);
  });

  test('the public tab shows the rounds, the standings and the podium', async ({
    page,
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId, eventSlug, tournamentSlug, ranked } = fixture;

    // Finalise so the podium resolves, THEN publish. A Swiss phase decides its
    // own podium from the standings; there are no bracket slots to read one from.
    const phaseId = (await readSwissStandings(api, fixture.tournamentId)).phaseId!;
    await api.ok(await api.post(`swiss-phases/${phaseId}/finalise`, { data: {} }));
    await api.ok(await api.post(`events/${eventId}/publish`, { data: {} }));
    await api.ok(await api.post(`tournaments/${fixture.tournamentId}/publish`, { data: {} }));

    const tournamentPath = `${publicBase}/e/${eventSlug}/t/${tournamentSlug}`;

    await open(page, `${tournamentPath}#swiss`);
    const swiss = panel(page, 'swiss');
    await expect(swiss).toBeVisible({ timeout: 30_000 });
    await expect(swiss).toContainText(ranked[0]!);
    // The bye is a distinct row, and an odd field owes one every round.
    await expect(swiss).toContainText('Bye');
    await expectNoRawKeys(page);

    // Standings used to be gated on `pools.length > 0`, which hid the tab for a
    // Swiss-only tournament — and it is the tab /me deep-links Swiss referees to.
    await open(page, `${tournamentPath}#standings`);
    await expect(panel(page, 'standings')).toBeVisible({ timeout: 30_000 });

    // The podium a Swiss phase decides on its own.
    await open(page, `${tournamentPath}#podium`);
    await expect(panel(page, 'podium')).toContainText(ranked[0]!, { timeout: 30_000 });
    await expectNoRawKeys(page);
  });

  /**
   * Nothing this spec created may be left on the public site.
   *
   * Identical to `15-public-site.spec.ts`'s reasoning: `E2E_CLEANUP` hard-deletes
   * (a club event is disposable even with results recorded); without it the
   * event is flipped to `event_kind: 'test'`, because the public resolver gates
   * on KIND, not status — an unpublished club event is still reachable by slug.
   */
  test.afterAll(async ({ playwright }) => {
    if (!fixture?.eventId) return;
    const { baseURL } = runContext();
    const cleanup = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());
    const ctx = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    const res = cleanup
      ? await ctx.delete(`/api/v1/events/${fixture.eventId}?mode=hard`)
      : await ctx.patch(`/api/v1/events/${fixture.eventId}`, { data: { eventKind: 'test' } });
    if (!res.ok()) {
      console.warn(
        `[e2e] could not ${cleanup ? 'delete' : 'hide'} swiss event ${fixture.eventId}: ${res.status()}`,
      );
    } else if (!cleanup) {
      console.log(
        `[e2e] swiss event hidden (event_kind=test) but PRESERVED:\n` +
          `        ${baseURL}/org/${fixture.orgSlug}/events/${fixture.eventId}/swiss`,
      );
    }
    await ctx.dispose();
  });
});

/** The slug the tournament was created with, read back rather than assumed. */
async function tournamentSlugOf(api: Api, tournamentId: string): Promise<string | null> {
  const tournament = await api.json<{ slug?: string }>(
    await api.get(`tournaments/${tournamentId}`),
  );
  return tournament.slug ?? null;
}
