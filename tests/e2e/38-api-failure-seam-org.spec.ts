import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { COPY, LOCALE_COOKIE, collectCrashes, expectStayedOn, problemJson } from './_seam';

/**
 * The `apiRequest` seam in a browser, on every screen that does NOT need a
 * platform login: the organizer surface and web-public.
 *
 * Split out of `37-api-failure-seam` when that file passed 500 lines and still
 * had eight conversion batches to absorb. The cut is by IDENTITY, which is the
 * only line that actually matters here: `37` earns a platform session in a
 * `beforeAll` and every test in it is skipped without one, while everything in
 * this file runs unconditionally on the organizer `storageState` the prod
 * config already applies. Splitting any other way would have put skipped and
 * unconditional assertions in the same file again — which is how an absent
 * platform account reads as a green.
 *
 * ── What this proves that the unit tests cannot ──────────────────────────────
 *
 * `failure-message.test.ts` calls the mapper with a hand-built `ApiFailure` and
 * a real translator. That is the right test for the mapping, and it is silent
 * about everything around it:
 *
 *   - the screens still LOAD against the real API after the rewrite — the seam
 *     sends the session cookie, and `credentials: 'include'` being a default
 *     rather than a per-call argument actually holds over the wire;
 *   - aborting on unmount does not surface as an unhandled rejection. The
 *     conversion replaced nineteen spellings of "was this an abort?" with one,
 *     and a missed spelling shows up here and nowhere else;
 *   - the sentence reaches the DOM in the reader's language. The mapper returns
 *     a string; only a browser can say whether the `mc_locale` cookie, the
 *     surface dictionary and the provider agree well enough to render it.
 *
 * ── Why failures are forced rather than provoked ─────────────────────────────
 *
 * The failure paths are stubbed with `page.route` on one request, against the
 * real app and the real session. Provoking a genuine 409 would mean creating a
 * venue that holds matches on the operator's live org — venues are org-scoped
 * and outlive the run's throwaway event, so a failed teardown leaves litter on
 * a production org. Forcing the response costs nothing and asserts the same
 * branch. The LOAD assertions are not stubbed at all.
 *
 * Every load assertion still pins the URL. The organizer session owns these
 * screens, but the shell redirects AFTER first paint on any surface it refuses,
 * so a heading alone is never evidence the page is ours.
 */

const ctx = runContext();

/** The deployed web-public host. Sibling of `E2E_PUBLIC_URL` in `15` and `24`. */
const PUBLIC_BASE = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(/\/$/, '');

/** The claim form's one request. */
const MAGIC_LINK = '**/api/v1/auth/magic-link';

/**
 * Distinctive on purpose: it must be findable on the page and impossible to
 * confuse with anything the screen could have said on its own.
 */
const FORCED_CLAIM_REASON = 'That profile belongs to a fighter who already signed in.';

/**
 * Fill the claim form and submit it.
 *
 * `personId` is a query parameter and the button is disabled without one. The
 * value is never dereferenced here — every test using this stubs the request —
 * so a made-up id keeps the run off the operator's real people.
 */
async function submitClaimForm(page: Page, locale: 'en' | 'fr' = 'en'): Promise<void> {
  // The form renders in the reader's locale, so it has to be DRIVEN in that
  // locale too. Hard-coding the English strings here made the one test that
  // switches the reader to French fail on its own first line — never reaching
  // the assertion it exists for.
  const copy =
    locale === 'fr'
      ? { title: COPY.claimTitleFr, email: COPY.claimEmailLabelFr, submit: COPY.claimSubmitFr }
      : { title: COPY.claimTitle, email: COPY.claimEmailLabel, submit: COPY.claimSubmit };

  await page.goto(`${PUBLIC_BASE}/e/${ctx.eventSlug}/claim?personId=e2e-not-a-real-person`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: copy.title })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel(copy.email).fill('e2e@example.com');
  await page.getByRole('button', { name: copy.submit }).click();
}

const VENUES_PATH = `/org/${ctx.orgSlug}/venues`;
const ORG_HOME_PATH = `/org/${ctx.orgSlug}`;
const ORG_RULESETS_PATH = `/org/${ctx.orgSlug}/rulesets/scoring`;

/** The org's venue list — the request the venue assertions force. */
const VENUES_LIST = '**/api/v1/organizations/*/venues';
/**
 * Exact, not a prefix. `*` stops at a slash in Playwright's glob, so the
 * Discover tab's `.../custom-rulesets/catalog` read stays unstubbed — only the
 * Manage list this screen opens on is forced.
 */
const ORG_RULESETS_LOAD = '**/api/v1/organizations/*/custom-rulesets';
const ORG_LEAGUES_PATH = `/org/${ctx.orgSlug}/leagues`;
/**
 * The public league catalogue — one of the four tolerant list reads the hub
 * makes after it resolves the organisation. Exact, so `/leagues/{id}/groups`
 * stays unstubbed.
 */
const LEAGUE_CATALOG_LOAD = '**/api/v1/leagues';
const ORG_EVENTS_PATH = `/org/${ctx.orgSlug}/events`;
/**
 * The org's event list. Exact, so the per-event venue and deletion-request
 * reads the same screen makes stay unstubbed — this forces the ONE read the
 * screen treats as fatal.
 */
const ORG_EVENTS_LOAD = '**/api/v1/organizations/*/events';
const ORG_ROSTER_PATH = `/org/${ctx.orgSlug}/events/${ctx.eventId}/persons`;
/** The roster read the participants screen opens with. */
const ORG_ROSTER_LOAD = '**/api/v1/events/*/persons';
const ORG_TOURNAMENTS_PATH = `/org/${ctx.orgSlug}/events/${ctx.eventId}/tournaments`;
/** The tournament list this screen is built on. */
const ORG_TOURNAMENTS_LOAD = '**/api/v1/events/*/tournaments';
/** The login screen's magic-link request. */
const MAGIC_LINK_LOGIN = '**/api/v1/auth/magic-link';
const ORG_REFEREES_PATH = `/org/${ctx.orgSlug}/events/${ctx.eventId}/referees`;
/** The assignment board the referees workspace opens on. */
const REFEREE_BOARD_LOAD = '**/api/v1/events/*/referee-assignment-board';
const ORG_SCHEDULE_PATH = `/org/${ctx.orgSlug}/events/${ctx.eventId}/schedule`;
/**
 * The first of the board's four bootstrap reads, and the one whose refusal it
 * reports under "Lices:". Exact, so the other three stay unstubbed and the
 * banner names this endpoint rather than whichever raced ahead.
 */
const SCHEDULE_LICES_LOAD = '**/api/v1/events/*/lices';
const ORG_DISCOVER_PATH = `/org/${ctx.orgSlug}/rulesets/scoring?tab=discover`;
/** The adoptable-ruleset catalogue behind the Discover tab. */
const ORG_DISCOVER_LOAD = '**/api/v1/organizations/*/custom-rulesets/catalog';

test.describe('the api-failure seam — the venues screen', () => {
  test('loads against the real API', async ({ page }) => {
    const crashes = collectCrashes(page);

    await page.goto(VENUES_PATH);
    await expect(page.getByRole('heading', { name: COPY.venuesTitle })).toBeVisible();
    await expectStayedOn(page, VENUES_PATH);

    // The load finished one way or the other: either the table or the empty
    // state replaced the loading line. A failure banner here is a real failure.
    await expect(page.getByText(COPY.venuesLoadError)).toBeHidden();
    await expect(page.getByText(COPY.networkEn)).toBeHidden();
    expect(crashes, crashes.join('\n')).toEqual([]);
  });

  test('leaving mid-load aborts quietly instead of throwing', async ({ page }) => {
    const crashes = collectCrashes(page);

    // Hold the venue list open so the unmount lands while it is still in
    // flight — that is the exact window the AbortController was added for.
    await page.route(VENUES_LIST, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.abort('aborted');
    });

    await page.goto(VENUES_PATH, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: COPY.venuesTitle })).toBeVisible();
    await page.goto(ORG_HOME_PATH);
    await expectStayedOn(page, ORG_HOME_PATH);

    // `failureMessage` answers null for an abort, so the screen we LEFT must
    // not have posted a sentence on the way out, and nothing may have thrown.
    await expect(page.getByText(COPY.venuesLoadError)).toBeHidden();
    await expect(page.getByText(COPY.networkEn)).toBeHidden();
    expect(crashes, crashes.join('\n')).toEqual([]);
  });

  test("a 4xx shows the server's own reason, not the screen's fallback", async ({ page }) => {
    await page.route(VENUES_LIST, (route) =>
      route.fulfill(problemJson(409, 'Venue is in use by a scheduled match')),
    );

    await page.goto(VENUES_PATH);

    await expect(page.getByText('Venue is in use by a scheduled match')).toBeVisible();
    await expect(page.getByText(COPY.venuesLoadError)).toBeHidden();
  });

  test('a 403 keeps the reason it was given', async ({ page }) => {
    await page.route(VENUES_LIST, (route) =>
      route.fulfill(problemJson(403, 'You are not an organiser of this venue')),
    );

    await page.goto(VENUES_PATH);

    await expect(page.getByText('You are not an organiser of this venue')).toBeVisible();
    await expect(page.getByText(COPY.unauthenticatedEn)).toBeHidden();
  });

  test("a scrubbed 5xx leaves the screen's own sentence in place", async ({ page }) => {
    // Exactly what the filter sends for any unhandled 500: a placeholder that
    // says less than the sentence the call site passed.
    await page.route(VENUES_LIST, (route) =>
      route.fulfill(problemJson(500, 'Internal server error')),
    );

    await page.goto(VENUES_PATH);

    await expect(page.getByText(COPY.venuesLoadError)).toBeVisible();
    await expect(page.getByText('Internal server error')).toBeHidden();
  });

  test('an unreachable server says so in the reader’s language', async ({ page, context }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'fr', domain: new URL(ctx.baseURL).hostname, path: '/' },
    ]);
    await page.route(VENUES_LIST, (route) => route.abort('failed'));

    await page.goto(VENUES_PATH);

    await expect(page.getByText(COPY.networkFr)).toBeVisible();
    await expect(page.getByText(COPY.networkEn)).toBeHidden();
  });
});

/**
 * The organizer-side scoring rulesets list.
 *
 * Its own block rather than a case inside the venues one: it runs on the same
 * default organizer context, but it is a different screen and reads a different
 * endpoint, and grouping it under "the venues screen" would make the reporter
 * lie about which surface went red.
 *
 * The slug resolve is deliberately left alone. Stubbing only the list read is
 * what proves the reason travels from the SECOND request — a screen that gave
 * up on the first one would show nothing here.
 */
test.describe('the api-failure seam — the org rulesets screen', () => {
  test("a 4xx shows the server's own reason, not the screen's fallback", async ({ page }) => {
    const reason = 'This organisation may not list rulesets while a merge is running.';
    await page.route(ORG_RULESETS_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_RULESETS_PATH);
    await expectStayedOn(page, ORG_RULESETS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.rulesetsLoadError)).toBeHidden();
  });
});

/**
 * The sign-in screen.
 *
 * Its own browser context with NO `storageState`: the config signs every other
 * context in as the organizer, and a signed-in visitor is not who this screen
 * is for. No login is spent — /login is public.
 *
 * The 429 is the refusal an operator actually meets here (login and magic-link
 * are throttled per email), and it is also the one place the seam's own words
 * beat the server's: Nest's throttler answers with the literal class name
 * "ThrottlerException: Too many requests".
 */
test.describe('the api-failure seam — the sign-in screen', () => {
  test('a throttled login link says to wait, not "failed"', async ({ browser }) => {
    const anonymous = await browser.newContext({
      baseURL: ctx.baseURL,
      storageState: undefined,
      ignoreHTTPSErrors: true,
    });
    const page = await anonymous.newPage();
    await page.route(MAGIC_LINK_LOGIN, (route) =>
      route.fulfill(problemJson(429, 'ThrottlerException: Too many requests')),
    );

    await page.goto('/login');
    await page.getByLabel(COPY.loginEmailLabel).fill('e2e-throttle@example.com');
    await page.getByRole('button', { name: COPY.loginSendLink }).click();

    await expect(page.getByText(COPY.tooManyRequestsEn)).toBeVisible();
    await expect(page.getByText('ThrottlerException')).toBeHidden();
    await expect(page.getByText(COPY.magicLinkFailed)).toBeHidden();
    await anonymous.close();
  });
});

/**
 * The tournament list — the screen every draw and schedule surface hangs off.
 */
test.describe('the api-failure seam — the tournament list', () => {
  test("a 4xx shows the server's own reason, not the screen's fallback", async ({ page }) => {
    const reason = 'Tournaments are read-only while the bracket rebuild finishes.';
    await page.route(ORG_TOURNAMENTS_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_TOURNAMENTS_PATH);
    await expectStayedOn(page, ORG_TOURNAMENTS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.tournamentsLoadError)).toBeHidden();
  });
});

/**
 * The participants roster — the busiest screen of a live event.
 *
 * Its three list reads are tolerant by design, so this asserts the half that
 * was missing: an empty roster and a REFUSED roster used to look identical.
 */
test.describe('the api-failure seam — the event roster', () => {
  test('a refused roster says why instead of looking empty', async ({ page }) => {
    const reason = 'The roster is locked while the check-in desk syncs. Try again in a minute.';
    await page.route(ORG_ROSTER_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_ROSTER_PATH);
    await expectStayedOn(page, ORG_ROSTER_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.rosterLoadError)).toBeHidden();
  });
});

/**
 * The organiser's event list — the screen an organiser opens first.
 */
test.describe('the api-failure seam — the org events list', () => {
  test("a 4xx shows the server's own reason, not the screen's fallback", async ({ page }) => {
    const reason = 'This organisation is being merged. Its events are read-only for a minute.';
    await page.route(ORG_EVENTS_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_EVENTS_PATH);
    await expectStayedOn(page, ORG_EVENTS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.eventsLoadError)).toBeHidden();
  });
});

/**
 * The Discover tab's shared catalogue component, which both ruleset surfaces
 * mount. Deep-linked with `?tab=discover` — the page opens on Manage otherwise,
 * and the catalogue read never fires.
 */
test.describe('the api-failure seam — the ruleset discover tab', () => {
  test("a 4xx shows the server's own reason, not the tab's fallback", async ({ page }) => {
    const reason = 'The shared catalogue is being re-indexed. Try again in a minute.';
    await page.route(ORG_DISCOVER_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_DISCOVER_PATH);
    await expectStayedOn(page, `/org/${ctx.orgSlug}/rulesets/scoring`);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.discoverLoadError)).toBeHidden();
  });
});

/**
 * The organizer-side leagues hub.
 *
 * Its four list reads are tolerant by design — each tab renders whatever did
 * load — so this asserts the half that was missing rather than the half that
 * works: a refused list now says WHY above the tabs instead of leaving an empty
 * Discover tab and no explanation.
 */
test.describe('the api-failure seam — the org leagues hub', () => {
  test('a refused list says why instead of showing an empty tab', async ({ page }) => {
    const reason = 'The league catalogue is being rebuilt. Try again in a minute.';
    await page.route(LEAGUE_CATALOG_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_LEAGUES_PATH);
    await expectStayedOn(page, ORG_LEAGUES_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.leaguesLoadError)).toBeHidden();
  });
});

/**
 * The schedule board.
 *
 * Not a drag: `dragTo` hangs in this grid (see the drag specs), and the thing
 * this batch changed is the READ path anyway. The board had a second fetch seam
 * of its own — `schedule-mutations` and `schedule-reads` — that stopped at the
 * body's `message`. A class-validator refusal puts its FIRST rejected field
 * there and the rest under `details.validationErrors`, so an organiser was told
 * about one field, fixed it, and was then told about the next.
 */
test.describe('the api-failure seam — the schedule board', () => {
  test('a refused bootstrap read names every field the API rejected', async ({ page }) => {
    const first = 'liceId must be a UUID';
    const second = 'scheduledAt is not a valid ISO date';
    await page.route(SCHEDULE_LICES_LOAD, (route) =>
      route.fulfill(problemJson(400, first, { validationErrors: [first, second] })),
    );

    await page.goto(ORG_SCHEDULE_PATH);
    await expectStayedOn(page, ORG_SCHEDULE_PATH);

    // The banner names the endpoint, then the whole reason. The second field is
    // the half that could not reach this screen before.
    await expect(page.getByText(COPY.scheduleFetchLicesPrefix)).toBeVisible();
    await expect(page.getByText(first)).toBeVisible();
    await expect(page.getByText(second)).toBeVisible();
  });
});

/**
 * The referee assignment board.
 *
 * Its read used to be one of eleven `body.message` copies on this screen, each
 * with its own fallback. Hard rule 8 is enforced here — a fighter may not
 * referee a pool overlapping their own match — and the API refuses by name.
 */
test.describe('the api-failure seam — the referee assignment board', () => {
  test("a 4xx shows the server's own reason, not the screen's fallback", async ({ page }) => {
    const reason = 'Referee assignments are locked while the crew list is being rebuilt.';
    await page.route(REFEREE_BOARD_LOAD, (route) => route.fulfill(problemJson(409, reason)));

    await page.goto(ORG_REFEREES_PATH);
    await expectStayedOn(page, ORG_REFEREES_PATH);
    // The workspace opens on the referee LIST; the board is the second tab,
    // and it is the only thing that reads the endpoint stubbed above.
    await page.getByRole('button', { name: COPY.refereeAssignmentsTab }).click();

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.refereeBoardLoadError)).toBeHidden();
  });
});

/**
 * web-public, which is a different app on a different host.
 *
 * ── What is asserted here, and what cannot be ────────────────────────────────
 *
 * Five web-public screens moved onto the seam. Three of them are not reachable
 * from this harness and are named rather than skipped, because a skipped test
 * reads as a green:
 *
 *   - `/me` and `/me/claim-confirm` need a COMPETITOR session. The harness
 *     holds an organizer and a platform account; neither is the person whose
 *     personal space those screens draw.
 *   - the workshop enrolment refusal needs a published workshop with a session
 *     on the throwaway event, which `global-setup` does not provision.
 *
 * The tournament page is asserted only through its 404 branch, and that is a
 * property of the conversion rather than a shortcut: it loads SERVER-side, so
 * `page.route` never sees the request and its 5xx branch cannot be forced from
 * a browser at all. The 404 branch needs no stub — an unknown slug is a real
 * 404 from the real API, and it is exactly the branch the rewrite had to keep
 * (`result.kind === 'http' && result.status === 404`), because collapsing it
 * once made every failure read as "tournament not found".
 */
test.describe('the api-failure seam — web-public', () => {
  test('an unknown tournament still reads as missing, not as a server fault', async ({ page }) => {
    await page.goto(`${PUBLIC_BASE}/e/${ctx.eventSlug}/t/does-not-exist-${Date.now()}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.getByText(COPY.tournamentNotFound)).toBeVisible({ timeout: 30_000 });
    // The other arm of the same branch. A 404 read as a server fault would put
    // this heading up instead, which is the regression the tri-state exists for.
    await expect(page.getByText(COPY.tournamentLoadFailed)).toBeHidden();
  });

  test("the claim form shows the server's own reason for a refusal", async ({ page }) => {
    await page.route(MAGIC_LINK, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({ detail: FORCED_CLAIM_REASON, message: FORCED_CLAIM_REASON }),
      }),
    );

    await submitClaimForm(page);

    await expect(page.getByText(FORCED_CLAIM_REASON)).toBeVisible();
    await expect(page.getByText(COPY.claimGenericError)).toBeHidden();
  });

  test('the claim form says the server is unreachable, in the reader’s language', async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'fr', domain: new URL(PUBLIC_BASE).hostname, path: '/' },
    ]);
    await page.route(MAGIC_LINK, (route) => route.abort('failed'));

    await submitClaimForm(page, 'fr');

    await expect(page.getByText(COPY.networkFr)).toBeVisible();
    await expect(page.getByText(COPY.networkEn)).toBeHidden();
  });
});
