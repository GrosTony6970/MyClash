/**
 * A mailed link signs its reader in on the server, then lands on `/auth/signed-in`.
 *
 * Paul's phone kept his schedule. Léa signs in on it with the link the site mailed her. The
 * link's landing removed nothing, so her schedule page showed Paul's day until her own read
 * landed, and all day with no signal. The landing page now removes every kept schedule, as a
 * password or Google sign-in does, then opens the page the link named.
 */
import { test, expect } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

const KEPT = 'myclash:schedule:test-event';

test("the link's landing removes the schedule the phone kept, then opens the page it names", async ({
  page,
}) => {
  await stubPublicApi(page);
  // Paul's copy, on the phone before the link is opened: set once, at the first page.
  await page.goto(`${PUBLIC}/e/test-event/home`);
  await page.evaluate(
    (key) =>
      localStorage.setItem(key, JSON.stringify({ schedule: { personId: 'paul' }, fetchedAt: 1 })),
    KEPT,
  );

  await page.goto(`${PUBLIC}/auth/signed-in?next=${encodeURIComponent('/e/test-event/home')}`);
  await page.waitForURL(`${PUBLIC}/e/test-event/home`);
  await waitForPageMain(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEPT)).toBeNull();
});

test('a landing that names another site opens the personal space', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/auth/signed-in?next=${encodeURIComponent('https://evil.example/')}`);
  await page.waitForURL(`${PUBLIC}/me`);
});
