/**
 * Android offers to install the app (operator rulings, 2026-11-18).
 *
 * On 2026-11-18 Chromium refused to install either app: the staff manifest's
 * only icon was 120 px ("no-acceptable-icon"), and the public app had no
 * manifest. Nothing in either app listened for Chrome's install offer, so
 * nothing ever asked.
 *
 * The verdict here is Chromium's own (`Page.getInstallabilityErrors`), the one
 * that was red. The offer is Chrome's `beforeinstallprompt`: a story sends a
 * recorded one, at DOMContentLoaded, before React has run. A listener React
 * added at hydration would miss it; the inline capture keeps it.
 */
import { test, expect, type Page } from '@playwright/test';
import { PAD, stubSignIn } from './pad-sign-in-stub';

/**
 * Chromium's reasons not to install the page, once its manifest is read.
 *
 * Asked of the FULL browser (`channel: 'chromium'`, its own headless mode).
 * Playwright's default headless shell answers no reason at all, whatever the
 * manifest: the old 120 px manifest passed there (checked 2026-11-18), so a
 * test on it holds nothing. `playwright install chromium` installs both.
 *
 * `in-incognito` is dropped, by name: every Playwright context is a private
 * window, and that reason says so of the test browser, not of the app.
 */
async function installabilityErrors(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    return installabilityErrors.map((error) => error.errorId).filter((id) => id !== 'in-incognito');
  } finally {
    await cdp.detach();
  }
}

/**
 * A recorded offer, sent at DOMContentLoaded. Chrome's own offers are stopped
 * first: a real `prompt()` in a test browser would open nothing anyone can close.
 */
async function offerAtLoad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { prompted: number };
    w.prompted = 0;
    window.addEventListener(
      'beforeinstallprompt',
      (event) => {
        if (event.isTrusted) event.stopImmediatePropagation();
      },
      true,
    );
    document.addEventListener('DOMContentLoaded', () => {
      const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => {
          w.prompted += 1;
          return Promise.resolve();
        },
      });
      window.dispatchEvent(offer);
    });
  });
}

const installButton = (page: Page) => page.getByRole('button', { name: /install the app/i });
const prompted = (page: Page) =>
  page.evaluate(() => (window as unknown as { prompted: number }).prompted);

// The whole file: Playwright takes a browser channel only at the top of a file.
test.use({ channel: 'chromium' });

test.describe('Chromium installs', () => {
  test('the staff sign-in page', async ({ page }) => {
    await stubSignIn(page);
    await page.goto(`${PAD}/login`);
    // The link is added in the browser, after hydration (`ManifestLink`).
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');

    await expect.poll(() => installabilityErrors(page)).toEqual([]);
  });
});

test.describe('the staff app', () => {
  test('the sign-in page offers to install, once', async ({ page }) => {
    await stubSignIn(page);
    await offerAtLoad(page);
    await page.goto(`${PAD}/login`);

    await installButton(page).click();

    expect(await prompted(page)).toBe(1);
    await expect(installButton(page)).toHaveCount(0);
  });

  test('with no offer from the browser, there is no button', async ({ page }) => {
    await stubSignIn(page);
    await page.goto(`${PAD}/login`);
    await expect(page.locator('#staffPin')).toBeVisible();

    await expect(installButton(page)).toHaveCount(0);
  });
});
