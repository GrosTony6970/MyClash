import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';
import { ensureRoster, personName, type Person } from './_bracket';
import { playTournamentToChampion, type FinishedTournament } from './_tournament';

/**
 * The public site, rendering data this run actually produced
 * (run with E2E_PUBLIC_SITE=1).
 *
 * `tests/a11y` already opens these pages, but it stubs `**\/api\/**` — so it
 * proves the markup is reachable and says nothing about whether the site can
 * show a real tournament. This spec is the other half: every assertion is on a
 * string that did not exist before this run started, so no fixture, cache or
 * stub can satisfy it. The champion's name on the final-ranking tab is the
 * sharpest of them — it is computed in the BROWSER by `computeFinalRanking`
 * from bracket rows the API served, so seeing it proves the whole chain from
 * scored exchanges to rendered podium.
 *
 * ── Why this builds its own event ────────────────────────────────────────────
 *
 * The shared throwaway event is `standard`, and publishing a standard event
 * ANNOUNCES it to the organisation's followers (`announcesOnPublish`) — a test
 * run must never do that to real people. It is also invisible to the public
 * while it stays a test event.
 *
 * `event_kind: 'club'` is the one kind that is fully public AND silent on
 * publish AND hard-deletable with results recorded. So this spec makes its own
 * club event, publishes it, and tears it down afterwards — nothing it creates
 * is left visible on the real site either way (see the teardown note).
 */
const PUBLIC_SITE = ['1', 'true', 'yes'].includes(
  (process.env.E2E_PUBLIC_SITE ?? '').toLowerCase(),
);

/** The deployed web-public host. Sibling of `E2E_SCORING_URL` in `06`. */
const publicBase = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(/\/$/, '');

const ROSTER_SIZE = 8;

interface Fixture {
  eventId: string;
  eventSlug: string;
  eventName: string;
  orgSlug: string;
  tournamentSlug: string;
  tournament: FinishedTournament;
  fighters: Person[];
  champion: Person;
}
let fixture: Fixture;

/** Navigate and wait for the app shell, not just the HTML document. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${publicBase}${path}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
}

/** Any element carrying this text, anywhere on the page. */
const showing = (page: Page, text: string) => page.getByText(text, { exact: false }).first();

/**
 * The tab panel for `key`, which is where an assertion about a tab belongs.
 *
 * Every panel stays in the DOM and the inactive ones carry `hidden`, so a
 * page-wide text lookup can match a fighter's name on a tab nobody is looking
 * at — and `.first()` will happily return that hidden copy.
 */
const panel = (page: Page, key: string) => page.locator(`#panel-${key}`);

test.describe('public site', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!PUBLIC_SITE, 'set E2E_PUBLIC_SITE=1 to publish an event and read it back publicly');

  test('an event page shows the tournament that was actually played', async ({ page, request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { orgId, orgSlug } = runContext();
    const token = Date.now().toString(36);

    // ── A public event of this spec's own ──────────────────────────────────
    const eventName = `E2E TEST (auto) public — ${token}`;
    const eventSlug = `e2e-public-${token}`;
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: eventName,
          slug: eventSlug,
          startDate: '2099-03-01',
          endDate: '2099-03-02',
          city: 'Testville',
          country: 'FR',
          // Public, silent on publish, disposable. See the header.
          eventKind: 'club',
        },
      }),
    );

    const fighters = await ensureRoster(
      api,
      event.id,
      Array.from({ length: ROSTER_SIZE }, (_, index) => ({
        givenName: 'Public',
        familyName: String(index + 1).padStart(2, '0'),
      })),
    );

    const tournamentSlug = `public-cup-${token}`;
    const tournament = await playTournamentToChampion(api, event.id, {
      name: `Public Cup ${token}`,
      slug: tournamentSlug,
      fighters,
    });
    const champion = tournament.personByRegistrationId.get(tournament.championRegistrationId)!;
    expect(champion, 'the played tournament produced no champion').toBeDefined();

    // The operator's real publishing flow, and a precondition for anything
    // meaningful being on screen. A DRAFT tournament hides its bracket and
    // final-ranking tabs entirely (`!isDraft`), and the ranking CONTENT gates a
    // second time on `status === 'completed'` — so an unpublished, unfinished
    // tournament falls back to the participants tab, where every fighter's name
    // is listed. An assertion that merely looked for the champion's name would
    // pass there while proving nothing.
    await api.ok(await api.post(`events/${event.id}/publish`, { data: {} }));
    await api.ok(await api.post(`tournaments/${tournament.id}/publish`, { data: {} }));
    await api.ok(
      await api.patch(`tournaments/${tournament.id}`, { data: { status: 'completed' } }),
    );

    fixture = {
      eventId: event.id,
      eventSlug,
      eventName,
      orgSlug,
      tournamentSlug,
      tournament,
      fighters,
      champion,
    };

    // ── The event home ─────────────────────────────────────────────────────
    // The name is unique to this run: a stubbed or cached page cannot show it.
    await open(page, `/e/${eventSlug}/home`);
    await expect(showing(page, eventName)).toBeVisible({ timeout: 30_000 });

    // ── The tournament, tab by tab ─────────────────────────────────────────
    const tournamentPath = `/e/${eventSlug}/t/${tournamentSlug}`;

    // Final ranking is computed in the BROWSER from the bracket the API serves,
    // so the champion's name here is the end of the whole chain: exchanges →
    // completed matches → bracket rows → computeFinalRanking → this page.
    await open(page, `${tournamentPath}#finalranking`);
    // In FIRST PLACE, not merely somewhere on the page: all eight fighters are
    // listed here, so a bare name check would pass for any of them. The gold
    // medal marks place 1, and only the real champion may be in that row.
    const goldRow = panel(page, 'finalranking').locator('tr').filter({ hasText: '🥇' }).first();
    await expect(goldRow).toBeVisible({ timeout: 30_000 });
    await expect(goldRow).toContainText(personName(champion));

    // The bracket tab draws the same fighters from the same rows.
    await open(page, `${tournamentPath}#bracket`);
    const bracket = panel(page, 'bracket');
    await expect(bracket).toBeVisible({ timeout: 30_000 });
    await expect(bracket).toContainText(personName(fighters[0]!));
    await expect(bracket).toContainText(personName(fighters[1]!));

    // Standings renders for the same tournament without erroring.
    // No pool phase in this bracket-only tournament, so `standings` is not one of
    // the visible tabs — the page falls back rather than rendering an empty one.
    // Asserting the tournament's own name keeps this honest about what it checks:
    // the page resolved and is the right tournament.
    await open(page, `${tournamentPath}#standings`);
    await expect(showing(page, `Public Cup ${token}`)).toBeVisible({ timeout: 30_000 });

    // ── Live ───────────────────────────────────────────────────────────────
    // Every match is finished, so this is the "nothing on now" state — which is
    // still a real render of a real event, and the page organisers project on a
    // screen all day.
    await open(page, `/e/${eventSlug}/live`);
    await expect(page).toHaveURL(new RegExp(`/e/${eventSlug}/live`));
  });

  test('the organiser directory lists the organiser and their event', async ({ page, request }) => {
    test.setTimeout(600_000);
    const { orgSlug, eventName, eventSlug } = fixture;
    const { user } = await apiFor(request).json<{ user: { display_name: string } }>(
      await apiFor(request).get('me'),
    );
    const accountName = user.display_name;

    // The directory itself.
    await open(page, '/organisers');
    const orgLink = page.locator(`a[href*="/o/${orgSlug}"]`).first();
    await expect(orgLink).toBeVisible({ timeout: 30_000 });

    // The organiser's own page carries the event this run published.
    await open(page, `/o/${orgSlug}`);
    await expect(showing(page, eventName)).toBeVisible({ timeout: 30_000 });

    // …and the event link from it resolves to the event we built.
    const eventLink = page.locator(`a[href*="/e/${eventSlug}"]`).first();
    await expect(eventLink).toBeVisible({ timeout: 30_000 });

    // ── The personal space ─────────────────────────────────────────────────
    // Session cookies are scoped to `.myclash.fr`, so the admin login carries
    // across to the public host — /me must render as the signed-in user rather
    // than bounce to the login page.
    await open(page, '/me');
    await expect(page).not.toHaveURL(/\/login/);
    // Positively signed in, not merely "did not redirect": the personal space
    // greets the account by name, and an anonymous render never can.
    await expect(showing(page, accountName)).toBeVisible({ timeout: 30_000 });
  });

  /**
   * The screens an organiser hands out.
   *
   * Two rules that only a browser can prove: the hub can be reached knowing
   * nothing but the event slug and lists the Lices to project, and the kiosk
   * route it links to carries NO spectator sign-in — a referee's PIN works only
   * on the scoring pad, so a `/login` link on that page is a dead end pointed at
   * exactly the people who most need the right door.
   */
  test('the display hub picks a Lice, and the kiosk has no spectator sign-in', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId, eventSlug } = fixture;
    const token = Date.now().toString(36);
    const mine = `Display A ${token}`;
    const other = `Display B ${token}`;
    for (const name of [mine, other]) {
      await api.ok(await api.post(`events/${eventId}/lices`, { data: { name } }));
    }

    // ── The hub ────────────────────────────────────────────────────────────
    await open(page, `/e/${eventSlug}/display`);
    await expect(showing(page, mine)).toBeVisible({ timeout: 30_000 });
    await expect(showing(page, other)).toBeVisible();
    // The staff door: the pad's PIN form with this event already filled in.
    const staffLink = page.locator(`a[href*="/login?event=${eventSlug}"]`).first();
    await expect(staffLink, 'the hub must point staff at the scoring pad').toBeVisible();

    // ── The kiosk it links to ──────────────────────────────────────────────
    await open(page, `/e/${eventSlug}/lice/${encodeURIComponent(mine)}/display`);
    await expect(showing(page, mine)).toBeVisible({ timeout: 30_000 });
    expect(
      await page.locator('a[href="/login"]').count(),
      'the spectator Sign in must not appear on a display route',
    ).toBe(0);

    // The control layer is mounted but faded out until the screen is touched.
    const controls = page.getByTestId('display-controls');
    await expect(controls).toHaveAttribute('aria-hidden', 'true');
    await page.mouse.move(400, 400);
    await expect(controls).toHaveAttribute('aria-hidden', 'false', { timeout: 10_000 });
    await expect(
      controls.locator(`a[href*="${encodeURIComponent(other)}"]`),
      'the switcher must offer the other Lice',
    ).toBeVisible({ timeout: 10_000 });
  });

  /**
   * Nothing this spec created may be left on the public site.
   *
   * `E2E_CLEANUP` hard-deletes the event outright — a club event is disposable
   * even with results recorded. Without it the event is flipped to
   * `event_kind: 'test'` instead of merely unpublished: the public resolver
   * gates on KIND, not on status, so an unpublished club event would still be
   * reachable by slug. Test kind is the only setting that actually hides it,
   * and it leaves the data inspectable in the admin UI.
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
        `[e2e] could not ${cleanup ? 'delete' : 'hide'} public event ${fixture.eventId}: ${res.status()}`,
      );
    } else if (!cleanup) {
      console.log(
        `[e2e] public event hidden (event_kind=test) but PRESERVED:\n` +
          `        ${baseURL}/org/${fixture.orgSlug}/events/${fixture.eventId}`,
      );
    }
    await ctx.dispose();
  });
});
