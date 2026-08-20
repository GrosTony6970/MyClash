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
  venuesTitle: 'Venues',
  venuesLoadError: 'Could not load venues.',
  backupsTitle: 'Backup Management',
  backupsLoadError: 'Failed to load backups.',
} as const;

const VENUES_PATH = `/org/${ctx.orgSlug}/venues`;
const ORG_HOME_PATH = `/org/${ctx.orgSlug}`;
const BACKUPS_PATH = '/admin/backups';

/** The org's venue list — the request the venue assertions force. */
const VENUES_LIST = '**/api/v1/organizations/*/venues';
/** One of the three the backups screen loads in parallel. */
const BACKUPS_SCHEDULE = '**/api/v1/admin/backups/schedule';

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
});
