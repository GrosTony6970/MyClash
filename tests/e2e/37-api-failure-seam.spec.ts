import { test, expect, type BrowserContext } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';
import { COPY, collectCrashes, expectStayedOn, problemJson } from './_seam';

/**
 * The `apiRequest` seam in a browser, on the platform consoles under `/admin`.
 *
 * ── Why this file holds only one identity ────────────────────────────────────
 *
 * The prod config applies the organizer `storageState` to every context, and
 * that identity is REFUSED this whole surface: `admin/*` answers it 403 and the
 * shell sends it to /login. It does that asynchronously, after painting the
 * heading, so a naive `expect(heading).toBeVisible()` passes on a page that is
 * already leaving. Every assertion here therefore runs on a platform session
 * earned once in `beforeAll`, and every assertion here is SKIPPED when
 * `E2E_SUPERADMIN_EMAIL` / `_PASSWORD` are absent.
 *
 * That skip is the reason the organizer and web-public assertions moved out to
 * `38-api-failure-seam-org.spec.ts`. Mixed in one file, an absent platform
 * account left a run that was mostly skipped and reported as green. Split by
 * identity, `38` runs unconditionally and `37` is visibly absent.
 *
 * Shared assertion copy and the three helpers live in `_seam.ts` — one owner,
 * so a silent i18n key rename reds both specs rather than only the one that
 * happened to keep the list.
 *
 * ── Why failures are forced rather than provoked ─────────────────────────────
 *
 * The failure paths are stubbed with `page.route` on one request, against the
 * real app and the real session. Provoking a genuine refusal on a platform
 * console would mean breaking something on the operator's live install.
 * Forcing the response costs nothing and asserts the same branch. The LOAD
 * assertion is not stubbed at all.
 */

const ctx = runContext();

const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? '';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? '';

const BACKUPS_PATH = '/admin/backups';
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
  // In THIS describe and not a new one: `auth/password-login` is throttled per
  // email, so the platform session is reused rather than re-earned.

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
