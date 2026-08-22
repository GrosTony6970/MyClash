import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';

/**
 * The two screens converted to the `apiRequest` seam, opened in a browser.
 *
 * The C4 slice (`6e5e105a..2a67fddf`) rewrote how these two load their data and
 * where their failure sentences come from, shipped with unit tests and a green
 * Lint chain, and was never opened in a page. Nothing in `tests/e2e` reached
 * them either: `07-populate-event` and `27-super-admin` touch `venues` and
 * `admin/backups` only as API-request-context calls and authz probes.
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
 * ── Two identities, because the screens need two ─────────────────────────────
 *
 * The organizer session in `storageState` owns venues and is REFUSED the backup
 * console — `admin/backups/*` answers it 403 and `SuperAdminShell` sends it to
 * /login. It does that asynchronously, after painting the heading, so a naive
 * `expect(heading).toBeVisible()` passes on a page that is already leaving.
 * That is why every load assertion here also pins the URL. The backups half
 * logs in as the platform account instead, once per file — `password-login` is
 * throttled to 3/hour per email, so a login is treated as scarce.
 *
 * ── Why failures are forced rather than provoked ─────────────────────────────
 *
 * The failure paths are stubbed with `page.route` on one request, against the
 * real app and the real session. Provoking a genuine 409 would mean creating a
 * venue that holds matches on the operator's live org — venues are org-scoped
 * and outlive the run's throwaway event, so a failed teardown leaves litter on
 * a production org. Forcing the response costs nothing and asserts the same
 * branch. The LOAD assertions are not stubbed at all.
 */

const ctx = runContext();

const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? '';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? '';

/** `LOCALE_COOKIE` in packages/i18n/src/runtime.ts. */
const LOCALE_COOKIE = 'mc_locale';

/**
 * Asserted verbatim, and on purpose. These are the only strings this seam can
 * put on screen, so a silent key rename SHOULD red this file — that is cheaper
 * than a test that passes against `[common.apiFailure.network]`.
 * Sources: packages/i18n/src/messages/{en,fr}/common.ts,
 *          packages/i18n/src/messages/en/{organizer,admin}.ts.
 */
const COPY = {
  networkEn: 'Could not reach the server. Check your connection and try again.',
  networkFr: 'Serveur injoignable. Vérifiez votre connexion puis réessayez.',
  unauthenticatedEn: 'Your session has expired, or this is not yours to see. Sign in again.',
  tooManyRequestsEn: 'Too many requests. Wait a moment and retry.',
  venuesTitle: 'Venues',
  venuesLoadError: 'Could not load venues.',
  backupsTitle: 'Backup Management',
  backupsLoadError: 'Failed to load backups.',
  systemVersionsLoadError: 'Failed to load system versions.',
  systemVersionsAccessDenied: 'Access denied. Super admin required.',
  organizationsLoadError: 'Failed to load organizations',
  usersLoadError: 'Failed to load platform accounts',
  rulesetsLoadError: 'Could not load curated rulesets.',
  tournamentNotFound: 'Tournament not found',
  tournamentLoadFailed: "This tournament couldn't be loaded",
  claimTitle: 'Confirm your profile',
  claimEmailLabel: 'Your registered email',
  claimSubmit: 'Send confirmation link',
  claimGenericError: 'Something went wrong while requesting the claim.',
  // The same three, in French. The locale test below sets `mc_locale=fr` before
  // it navigates, so the form it has to fill in is French — and driving it with
  // the English strings above is why that test could never reach its assertion.
  claimTitleFr: 'Confirmez votre profil',
  claimEmailLabelFr: 'Votre e-mail enregistré',
  claimSubmitFr: 'Envoyer le lien de confirmation',
} as const;

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
const BACKUPS_PATH = '/admin/backups';

/** The org's venue list — the request the venue assertions force. */
const VENUES_LIST = '**/api/v1/organizations/*/venues';
/** One of the three the backups screen loads in parallel. */
const BACKUPS_SCHEDULE = '**/api/v1/admin/backups/schedule';
const SYSTEM_VERSIONS_PATH = '/admin/system-versions';
/** Exact, not a prefix: the components sub-route must stay unstubbed. */
const SYSTEM_VERSIONS_LOAD = '**/api/v1/admin/system-versions';
const ORGANIZATIONS_PATH = '/admin/organizations';
/** The list read carries a query string, so this one IS a prefix match. */
const ORGANIZATIONS_LOAD = '**/api/v1/admin/organizations?*';
const USERS_PATH = '/admin/users';
const USERS_LOAD = '**/api/v1/admin/users?*';
const RULESETS_PATH = '/admin/rulesets/scoring';
/** Exact: the per-ruleset action routes below it must stay unstubbed. */
const RULESETS_LOAD = '**/api/v1/admin/custom-rulesets';

/** What the API's exception filter actually sends (api-exception.filter.ts). */
function problemJson(status: number, detail: string) {
  return {
    status,
    contentType: 'application/problem+json; charset=utf-8',
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Forced by 37-api-failure-seam',
      status,
      detail,
      message: detail,
      statusCode: status,
      path: '/forced',
      method: 'GET',
      timestamp: new Date().toISOString(),
    }),
  };
}

/**
 * Uncaught exceptions and unhandled rejections only. Deliberately NOT every
 * console error: `OrganizerLayout` writes one on purpose as slug telemetry and
 * a refused request logs one of its own, so a spec that forbade all of them
 * would be asserting something this seam does not own.
 */
function collectCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && /unhandled|AbortError|TimeoutError/i.test(text)) {
      crashes.push(`console: ${text}`);
    }
  });
  return crashes;
}

/**
 * The shell's auth gate redirects AFTER first paint, so "the heading rendered"
 * is not evidence the screen is ours. Give it a beat and pin the URL.
 */
async function expectStayedOn(page: Page, path: string) {
  await page.waitForTimeout(2_000);
  expect(new URL(page.url()).pathname, `bounced off ${path}`).toBe(path);
}

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

test.describe('the api-failure seam — the backup console', () => {
  let platform: BrowserContext | null = null;

  test.beforeAll(async ({ browser }) => {
    if (!SUPER_EMAIL || !SUPER_PASSWORD) return;

    // Its own cookie jar: the config applies the organizer's storageState to
    // every context, and that identity is refused this whole surface.
    platform = await browser.newContext({
      baseURL: ctx.baseURL,
      storageState: undefined,
      ignoreHTTPSErrors: true,
    });
    const api = apiFor(platform.request);
    await api.ok(
      await api.post('auth/password-login', {
        data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
      }),
    );

    // Loud, and first. Without the platform role every assertion below would
    // pass vacuously against a screen that is on its way to /login.
    const identity = await api.json<{ admin: { platformRole: string | null } }>(
      await api.get('me'),
    );
    expect(
      identity.admin.platformRole,
      `${SUPER_EMAIL} needs a platform_roles row to reach the backup console`,
    ).toBe('super_admin');
  });

  test.afterAll(async () => {
    await platform?.close();
    platform = null;
  });

  test('loads against the real API', async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();
    const crashes = collectCrashes(page);

    await page.goto(BACKUPS_PATH);
    await expect(page.getByRole('heading', { name: COPY.backupsTitle })).toBeVisible();
    await expectStayedOn(page, BACKUPS_PATH);

    await expect(page.getByText(COPY.backupsLoadError)).toBeHidden();
    await expect(page.getByText(COPY.networkEn)).toBeHidden();
    expect(crashes, crashes.join('\n')).toEqual([]);
    await page.close();
  });

  test("a scrubbed 5xx leaves the screen's own sentence in place", async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    await page.route(BACKUPS_SCHEDULE, (route) =>
      route.fulfill(problemJson(500, 'Internal server error')),
    );
    await page.goto(BACKUPS_PATH);
    await expectStayedOn(page, BACKUPS_PATH);

    await expect(page.getByText(COPY.backupsLoadError)).toBeVisible();
    await expect(page.getByText('Internal server error')).toBeHidden();
    await page.close();
  });

  // ── The system versions console, converted in the same slice ──────────────
  //
  // In THIS describe and not a new one: `auth/password-login` is throttled to
  // 3/hour per email, so the platform session is reused rather than re-earned.

  test("the versions console shows the server's own reason, not its fallback", async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    const reason = 'The deploy manifest is being rewritten. Try again in a moment.';
    await page.route(SYSTEM_VERSIONS_LOAD, (route) => route.fulfill(problemJson(409, reason)));
    await page.goto(SYSTEM_VERSIONS_PATH);
    await expectStayedOn(page, SYSTEM_VERSIONS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.systemVersionsLoadError)).toBeHidden();
    await page.close();
  });

  test('a platform-role refusal keeps the screen’s own sentence', async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    // Deliberate exception to "the server's reason wins": PlatformRoleGuard
    // only ever says "Platform access required", which names no tier, and it is
    // English-only. Same call admin/backups makes. If this ever starts showing
    // the server's sentence, that decision was reversed by accident.
    await page.route(SYSTEM_VERSIONS_LOAD, (route) =>
      route.fulfill(problemJson(403, 'Platform access required')),
    );
    await page.goto(SYSTEM_VERSIONS_PATH);
    await expectStayedOn(page, SYSTEM_VERSIONS_PATH);

    await expect(page.getByText(COPY.systemVersionsAccessDenied)).toBeVisible();
    await expect(page.getByText('Platform access required')).toBeHidden();
    await page.close();
  });

  test("the organizations console shows the server's own reason, not its fallback", async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    const reason = 'That organisation list is being rebuilt. Try again shortly.';
    await page.route(ORGANIZATIONS_LOAD, (route) => route.fulfill(problemJson(409, reason)));
    await page.goto(ORGANIZATIONS_PATH);
    await expectStayedOn(page, ORGANIZATIONS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.organizationsLoadError)).toBeHidden();
    await page.close();
  });

  test('a throttled accounts console says to wait, not "failed"', async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    // The one refusal where the server's words lose. Nest's throttler sends the
    // literal "ThrottlerException: Too many requests" — a class name — and the
    // screen's own fallback says nothing about waiting either.
    await page.route(USERS_LOAD, (route) =>
      route.fulfill(problemJson(429, 'ThrottlerException: Too many requests')),
    );
    await page.goto(USERS_PATH);
    await expectStayedOn(page, USERS_PATH);

    await expect(page.getByText(COPY.tooManyRequestsEn)).toBeVisible();
    await expect(page.getByText('ThrottlerException')).toBeHidden();
    await expect(page.getByText(COPY.usersLoadError)).toBeHidden();
    await page.close();
  });

  test("the scoring rulesets list shows the server's own reason", async () => {
    test.skip(!platform, 'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD');
    const page = await platform!.newPage();

    const reason = 'A ruleset migration is running. Try again in a minute.';
    await page.route(RULESETS_LOAD, (route) => route.fulfill(problemJson(409, reason)));
    await page.goto(RULESETS_PATH);
    await expectStayedOn(page, RULESETS_PATH);

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(COPY.rulesetsLoadError)).toBeHidden();
    await page.close();
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
