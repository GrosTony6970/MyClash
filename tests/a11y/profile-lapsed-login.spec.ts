/**
 * The profile's reads and writes renew a lapsed login (the class of `fetchRenewingLogin`).
 *
 * Léa leaves her profile open after lunch. Her login cookie lasts an hour, and only `/me` renews
 * it. The Referee tab read with a raw `fetch`, so its first read after the hour got a 401 and
 * said "Could not load referee statistics"; a save of her profile failed the same way, and so did
 * every retry. Both now renew the login once and ask again.
 */
import { expect, test, type Page } from '@playwright/test';
import { openProfile } from './profile-stub';

/** The next answer of `pattern` is a 401, as for a login that ended; the ones after are normal. */
async function lapsedOnce(page: Page, pattern: string) {
  const asked = { count: 0 };
  await page.route(pattern, (route) => {
    asked.count += 1;
    return asked.count === 1
      ? route.fulfill({ status: 401, json: { status: 401, detail: 'expired' } })
      : route.fallback();
  });
  return asked;
}

test('the Referee tab renews a lapsed login and shows her statistics', async ({ page }) => {
  await openProfile(page);
  const reads = await lapsedOnce(page, '**/api/v1/fighters/me/referee-stats');

  await page.getByRole('tab', { name: 'Referee' }).click();

  // The refused read, then the one after the renewal (a dev server mounts the tab twice).
  await expect.poll(() => reads.count).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Refereed matches')).toBeVisible();
  await expect(page.getByText('Could not load referee statistics.')).toHaveCount(0);
});

test('a save renews a lapsed login and is saved', async ({ page }) => {
  const { saves } = await openProfile(page);
  const writes = await lapsedOnce(page, '**/api/v1/fighters/me/profile');

  await page.getByRole('textbox', { name: 'Bio' }).fill('Longsword, Lyon.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => writes.count).toBe(2);
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ bio: 'Longsword, Lyon.' });
});
