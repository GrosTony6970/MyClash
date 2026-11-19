import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { runContext } from '../e2e/_context';
import type { Api } from '../e2e/_api';

/**
 * The guide's "Event day" screenshots
 * (docs/superpowers/specs/2026-11-19-guide-event-day-design.md): the welcome
 * desk and the gear check tablets, the bout scoreboard for a venue screen, and
 * the wall view.
 *
 * The desk and gear accounts are created on the caller's test Event and signed
 * in with their PIN in a browser that holds no organiser cookie, as
 * tests/e2e/44-desk-screens.spec.ts does. Never `networkidle` on the staff app:
 * its service worker and heartbeat keep the network busy.
 *
 * Split out of screenshots.spec.ts for the 400-line file budget
 * (quality:complexity).
 */
const PIN = '481902';
const TABLET = { width: 1180, height: 820 };
const SCREEN = { width: 1280, height: 720 };
const DESKTOP = { width: 1280, height: 800 };

export async function shootEventDay(
  page: Page,
  browser: Browser,
  api: Api,
  eventId: string,
  liveBoutId: string,
  out: string,
): Promise<void> {
  const { slug } = await api.json<{ slug: string }>(await api.get(`events/${eventId}`));
  await shootTablet(browser, api, { eventId, slug, role: 'checkin', out });
  await shootTablet(browser, api, { eventId, slug, role: 'gear', out });

  // The scoreboard a venue screen shows: the opened bout, before its first hit.
  await page.setViewportSize(SCREEN);
  await page.goto(`/display/${liveBoutId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Testville Open 2099').first()).toBeVisible({ timeout: 30_000 });
  await settleThenShoot(page, `${out}/15-venue-scoreboard.png`);

  await page.setViewportSize(DESKTOP);
  await page.goto(`/display/wall/${eventId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Piste 1').first()).toBeVisible({ timeout: 30_000 });
  await settleThenShoot(page, `${out}/15-live-wall.png`);
  // No shot of a bout's own page yet: on 2026-11-19 it showed every hit as
  // "? +0" (it reads camelCase fields the exchanges route does not send).
}

/** One tablet account of `role`, signed in with its PIN, one tap made, then the shot. */
async function shootTablet(
  browser: Browser,
  api: Api,
  o: { eventId: string; slug: string; role: 'checkin' | 'gear'; out: string },
): Promise<void> {
  const { baseURL } = runContext();
  const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/u, '');
  const username = `${o.role}${Date.now().toString(36)}`.slice(0, 20);
  await api.ok(
    await api.post(`events/${o.eventId}/staff-accounts`, {
      data: {
        displayName: o.role === 'checkin' ? 'Welcome desk' : 'Gear check',
        username,
        pin: PIN,
        role: o.role,
      },
    }),
  );
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
    locale: 'en-GB',
    viewport: TABLET,
  });
  try {
    const page = await signInWithPin(context, staffBase, o.slug, username);
    if (o.role === 'checkin') {
      await page.goto(`${staffBase}/desk`);
      await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible({
        timeout: 30_000,
      });
      // One arrival, so the shot shows both states of a row.
      await page.getByRole('button', { name: 'Arrived', exact: true }).first().click();
      await expect(page.getByRole('tab', { name: 'Arrived (1)', exact: true })).toBeVisible();
      await expectNoPhoto(page);
      await page.screenshot({ path: `${o.out}/14-desk.png` });
    } else {
      await page.goto(`${staffBase}/gear`);
      await expect(page.getByRole('heading', { name: 'Gear check' })).toBeVisible({
        timeout: 30_000,
      });
      // One weapon passed, so the shot shows a result beside the buttons.
      await page.getByRole('button', { name: 'Pass', exact: true }).first().click();
      await expect(page.getByRole('button', { name: 'Re-check' }).first()).toBeVisible();
      await expectNoPhoto(page);
      await page.screenshot({ path: `${o.out}/14-gear.png` });
    }
  } finally {
    await context.close();
  }
}

/** The link an organiser hands out (`?event=&u=`), so only the PIN is typed; resolves once signed in. */
async function signInWithPin(
  context: BrowserContext,
  staffBase: string,
  slug: string,
  username: string,
): Promise<Page> {
  const { baseURL } = runContext();
  await context.addCookies(
    [...new Set([baseURL, staffBase].map((url) => new URL(url).origin))].map((url) => ({
      name: 'mc_locale',
      value: 'en',
      url,
    })),
  );
  const page = await context.newPage();
  await page.goto(`${staffBase}/login?event=${encodeURIComponent(slug)}&u=${username}`);
  await expect(page.locator('#staffUsername')).toHaveValue(username, { timeout: 30_000 });
  await page.fill('#staffPin', PIN);
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  // A good PIN leaves the login page. Not an API probe: the staff app may live on
  // its own host (staff.myclash.fr), whose session cookie the admin host never sees.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
  return page;
}

async function settleThenShoot(page: Page, path: string): Promise<void> {
  // Live screens hold a connection open, so idle may never come: settle or move on.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expectNoPhoto(page);
  await page.screenshot({ path });
}

/**
 * These screens show a person's photo, a club logo or an Event logo as an
 * `<img>`. The guide's roster is invented and has none of them, so any image
 * means a profile link reached a real person (or a photo was added to an
 * invented profile): stop before the picture is taken (hard rule 7).
 */
async function expectNoPhoto(page: Page): Promise<void> {
  expect(
    await page.locator('img').count(),
    'an image is on screen; it may show a real person, so this screenshot is not taken',
  ).toBe(0);
}
