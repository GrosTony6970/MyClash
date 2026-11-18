import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import {
  PIN,
  WEAPON,
  buildDeskFixture,
  disposeDeskEvents,
  organizerContext,
  type DeskFixture,
} from './_desk';

/**
 * The check-in desk and the gear table, as a volunteer taps them
 * (run with `E2E_STAFF=1`).
 *
 * `33-staff-desk` proves the API under these screens — routes, roles, the
 * idempotent arrive, the pass token. It never opens a page, so it cannot tell
 * that the screen sends what the API expects, draws what the API answers, or
 * counts its tabs from the roster it was sent. This spec drives the two pages
 * in a real browser, signed in with a real PIN, on the same kind of Event `33`
 * builds (`_desk.ts`), and checks each tap against the server afterwards.
 *
 * Things worth knowing before touching it:
 *
 *   - **The login lands outside the mount.** After a PIN login the page sends
 *     the volunteer to the role's path (`arrivalPathForRole`: `/desk`, `/gear`),
 *     root-absolute. Under the admin host's `/staff` mount that is the ADMIN
 *     app's `/desk`, which does not exist. So, as `18` does, the spec asserts
 *     the SESSION, then opens `${staffBase}/desk` itself.
 *   - **No row has a role or a test id.** A desk row is a plain `div`. The spec
 *     types a unique family name into the search, so one row is left, and then
 *     asks for page-level buttons. The tabs are `role="tab"`, so the button
 *     "Arrived" and the tab "Arrived (1)" never collide.
 *   - **Nothing is optimistic.** Every tap is a POST followed by a full roster
 *     GET; the counts on the tabs move only after that GET. The assertions wait
 *     on the tab labels, which is the settle signal.
 *   - **Never `waitUntil: 'networkidle'`** on the staff app: its service worker
 *     and heartbeat keep the network busy (see `18`).
 *   - **The camera is not driven.** The scan lane has no manual token field, and
 *     a headless browser has no camera. The spec opens the lane and comes back;
 *     `33` proves a scanned token reaches the server.
 */
const STAFF = ['1', 'true', 'yes'].includes((process.env.E2E_STAFF ?? '').toLowerCase());

interface DeskEntry {
  personId: string;
  arrived: boolean;
  via: string | null;
}

interface GearEntry {
  person: { personId: string };
  weapons: Array<{ weaponName: string; result: string | null; reason: string | null }>;
}

const createdEventIds: string[] = [];
let fixture: DeskFixture | null = null;

test.describe('desk screens', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!STAFF, 'set E2E_STAFF=1 to drive the check-in desk and gear table screens');

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    const { orgId, baseURL } = runContext();
    const ctx = await organizerContext(playwright, baseURL);
    try {
      fixture = await buildDeskFixture(apiFor(ctx), orgId, createdEventIds);
    } finally {
      await ctx.dispose();
    }
  });

  test.afterAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    const { baseURL, orgSlug } = runContext();
    await disposeDeskEvents(playwright, baseURL, orgSlug, createdEventIds);
  });

  test('the desk marks an arrival, keeps it across a reload, and undoes it', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { context, page, staffApi } = await signedIn(browser, f, f.deskUser);
    try {
      await page.goto(`${staffBase()}/desk`);
      await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible({
        timeout: 30_000,
      });
      const tabs = page.getByRole('tablist', { name: 'Filter the roster' });
      await expect(tabs.getByRole('tab', { name: 'All (4)' })).toBeVisible();
      await expect(tabs.getByRole('tab', { name: 'Arrived (0)' })).toBeVisible();

      // ── The Not arrived tab says when each person fights next ──────────────
      // The one scheduled bout is people[0] against people[1], so exactly two
      // rows name its Tournament and piste; the other two are not scheduled.
      // The time is in the browser's zone, so it is not asserted.
      await tabs.getByRole('tab', { name: 'Not arrived (4)' }).click();
      await expect(page.getByText(f.tournamentName, { exact: false })).toHaveCount(2);
      await expect(page.getByText(f.liceName, { exact: false })).toHaveCount(2);
      await expect(page.getByText('Not scheduled yet', { exact: true })).toHaveCount(2);
      await tabs.getByRole('tab', { name: 'All (4)' }).click();

      // ── Mark one arrival, through the search ──────────────────────────────
      const person = f.people[1]!;
      const search = page.getByRole('searchbox', { name: 'Search a name' });
      await search.fill(person.familyName);
      await page.getByRole('button', { name: 'Arrived', exact: true }).click();
      await expect(tabs.getByRole('tab', { name: 'Arrived (1)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();

      // The server holds it, and says how it was marked.
      const marked = (await deskRoster(staffApi)).find((e) => e.personId === person.id);
      expect(
        { arrived: marked?.arrived, via: marked?.via },
        'the tap must reach the server as an arrival found by search',
      ).toEqual({ arrived: true, via: 'search' });

      // ── A reload draws the same state from the server ──────────────────────
      await page.reload();
      await expect(tabs.getByRole('tab', { name: 'Arrived (1)' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(tabs.getByRole('tab', { name: 'Not arrived (3)' })).toBeVisible();

      // ── Undo puts the person back, on screen and on the server ────────────
      await search.fill(person.familyName);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(tabs.getByRole('tab', { name: 'Arrived (0)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Arrived', exact: true })).toBeVisible();
      const undone = (await deskRoster(staffApi)).find((e) => e.personId === person.id);
      expect(undone?.arrived, 'undo must reach the server').toBe(false);

      // ── The scan lane opens and leads back to the desk ─────────────────────
      // With no camera the lane shows its camera-unavailable panel; either way
      // its "Desk" button returns to the list a volunteer can still search.
      await page.getByRole('button', { name: 'Scan QR' }).click();
      await expect(page.getByRole('heading', { name: 'Scan pass' })).toBeVisible();
      await page.getByRole('button', { name: 'Desk', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('the gear table records a pass and a conditional with its reason', async ({ browser }) => {
    test.setTimeout(180_000);
    const f = required(fixture);
    const { context, page, staffApi } = await signedIn(browser, f, f.gearUser);
    try {
      await page.goto(`${staffBase()}/gear`);
      await expect(page.getByRole('heading', { name: 'Gear check' })).toBeVisible({
        timeout: 30_000,
      });
      const tabs = page.getByRole('tablist', { name: 'Filter the roster' });
      // A person with no weapon counts as "to check", so all four start there.
      await expect(tabs.getByRole('tab', { name: 'To check (4)' })).toBeVisible();
      await expect(tabs.getByRole('tab', { name: 'Pass (0)' })).toBeVisible();
      const search = page.getByRole('searchbox', { name: 'Search a name' });

      // ── A pass, recorded at once ───────────────────────────────────────────
      const passer = f.people[0]!;
      await search.fill(passer.familyName);
      await expect(page.getByText(WEAPON, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Pass', exact: true }).click();
      await expect(tabs.getByRole('tab', { name: 'Pass (1)' })).toBeVisible();
      await expect(tabs.getByRole('tab', { name: 'To check (3)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Re-check' })).toBeVisible();

      // ── A conditional cannot be saved without its reason ───────────────────
      const conditional = f.people[1]!;
      const reason = 'E2E: mask strap is loose';
      await search.fill(conditional.familyName);
      await page.getByRole('button', { name: 'Conditional', exact: true }).click();
      const save = page.getByRole('button', { name: 'Save conditional' });
      await expect(save, 'a conditional with no reason must not be savable').toBeDisabled();
      await page.getByLabel('Conditional — what must be fixed? (required)').fill(reason);
      await save.click();
      await expect(tabs.getByRole('tab', { name: 'Conditional (1)' })).toBeVisible();
      await expect(page.getByText(reason)).toBeVisible();

      // ── A person with no weapon says so, rather than offering buttons ──────
      await search.fill(f.people[2]!.familyName);
      await expect(
        page.getByText('No weapon resolved for this fighter — check their tournament entries.'),
      ).toBeVisible();

      // The server holds both results, the reason with the conditional.
      const gear = await gearRoster(staffApi);
      const resultOf = (personId: string) =>
        gear.find((g) => g.person.personId === personId)?.weapons[0];
      expect(resultOf(passer.id)?.result).toBe('pass');
      expect({
        result: resultOf(conditional.id)?.result,
        reason: resultOf(conditional.id)?.reason,
      }).toEqual({ result: 'conditional', reason });
    } finally {
      await context.close();
    }
  });

  test('a screen refuses an account of the wrong role', async ({ browser }) => {
    test.setTimeout(120_000);
    const f = required(fixture);
    // A scorer on the desk. The page draws first and swaps itself out once the
    // session's role is read, so the spec waits for the refusal, not for the
    // desk to disappear.
    const { context, page } = await signedIn(browser, f, f.scoringUser);
    try {
      await page.goto(`${staffBase()}/desk`);
      await expect(
        page.getByRole('heading', { name: 'Wrong account for this screen' }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function required(f: DeskFixture | null): DeskFixture {
  if (!f) throw new Error('[e2e] the desk fixture was never built — see beforeAll');
  return f;
}

/** Where the staff app is served: its own host, or the admin host's `/staff` mount. */
const staffBase = (): string =>
  (process.env.E2E_STAFF_URL ?? `${runContext().baseURL}/staff`).replace(/\/$/, '');

/**
 * A browser with NO organizer cookie, signed in through the staff app's own
 * login page with the link an organiser hands out (`?event=&u=`), so only the
 * PIN is typed. Resolves once the session exists — not on the landing URL,
 * which escapes the `/staff` mount (see the header).
 */
async function signedIn(
  browser: Browser,
  f: DeskFixture,
  username: string,
): Promise<{ context: BrowserContext; page: Page; staffApi: Api }> {
  const context = await browser.newContext({
    baseURL: runContext().baseURL,
    storageState: undefined,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  });
  const page = await context.newPage();
  const staffApi = apiFor(context.request);
  await page.goto(
    `${staffBase()}/login?event=${encodeURIComponent(f.eventSlug)}&u=${encodeURIComponent(username)}`,
  );
  await expect(page.locator('#staffUsername')).toHaveValue(username, { timeout: 30_000 });
  await page.fill('#staffPin', PIN);
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  await expect
    .poll(async () => (await staffApi.get('staff-auth/me')).status(), {
      timeout: 30_000,
      message: `the PIN login of ${username} never produced a staff session`,
    })
    .toBe(200);
  return { context, page, staffApi };
}

const deskRoster = async (api: Api): Promise<DeskEntry[]> =>
  (await api.json<{ entries: DeskEntry[] }>(await api.get('staff/checkin/roster'))).entries;

const gearRoster = async (api: Api): Promise<GearEntry[]> =>
  (await api.json<{ entries: GearEntry[] }>(await api.get('staff/gear/roster'))).entries;
