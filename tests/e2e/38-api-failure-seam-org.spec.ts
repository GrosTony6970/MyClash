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
