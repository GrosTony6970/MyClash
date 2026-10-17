/**
 * A tab reads the page, then the Event; outside an Event, the page, then the
 * site (quick wins F15, F16; operator ruling 2026-10-13).
 *
 * Tabs read "Longsword Open · MyClash — MyClash", "Home — test-event" and
 * "Match 12", and eighteen pages had no title of their own. The Event's NAME
 * comes from a read on the server: `scripts/e2e-server-api-stub.mjs` answers it
 * for `test-event` ("Open de Lyon") and fails it for `broken-event`.
 */
import { test, expect } from '@playwright/test';
import { stubPublicApi } from './helpers';
import { PUBLIC } from './public-pages-stub';

const INSIDE_AN_EVENT: Array<[path: string, title: string]> = [
  ['home', 'Home · Open de Lyon'],
  ['tournaments', 'Tournaments · Open de Lyon'],
  ['participants', 'Participants · Open de Lyon'],
  ['workshops', 'Workshops · Open de Lyon'],
  ['schedule/tournaments', 'Tournament schedule · Open de Lyon'],
  // Pages drawn in the browser: a layout beside each names its tab.
  ['live', 'Live · Open de Lyon'],
  ['my-schedule', 'My schedule · Open de Lyon'],
  ['pass', 'My pass · Open de Lyon'],
  ['people', 'Find a participant · Open de Lyon'],
  ['people/p-1', 'Participant · Open de Lyon'],
  // A bout names its two fighters; with a name missing, its number.
  ['match/bout-1', 'Jean Dupont vs Paul Martin · Open de Lyon'],
  ['match/bout-nameless', 'Match L1-P1-M03 · Open de Lyon'],
];

for (const [path, title] of INSIDE_AN_EVENT) {
  test(`/e/test-event/${path} reads "${title}"`, async ({ page }) => {
    await stubPublicApi(page);
    await page.goto(`${PUBLIC}/e/test-event/${path}`);

    await expect(page).toHaveTitle(title);
  });
}

test('a page of an Event with no words of its own reads the Event alone', async ({ page }) => {
  await stubPublicApi(page);
  // A TV screen: fullscreen on a wall, it gives no title. Not "Open de Lyon · MyClash".
  await page.goto(`${PUBLIC}/e/test-event/lice/piste-1/display`);

  await expect(page).toHaveTitle('Open de Lyon');
});

test('with no name to give, the tab reads the address of the Event', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/broken-event/live`);

  await expect(page).toHaveTitle('Live · broken-event');
});

const OUTSIDE_AN_EVENT: Array<[path: string, title: string]> = [
  ['/login', 'Sign in · MyClash'],
  ['/leagues', 'Leagues · MyClash'],
  ['/me', 'My space · MyClash'],
  // Pages below a page that names its own tab: the site's name is still there.
  ['/me/events', 'My events · MyClash'],
  // One Event of the personal space names the Event (ruling 2026-10-16): two Events, two tabs.
  ['/me/events/test-event', 'My event · Open de Lyon'],
  ['/me/events/test-event/schedule', 'My schedule · Open de Lyon'],
  ['/me/settings', 'Settings · MyClash'],
  ['/me/security', 'Security · MyClash'],
  ['/reset-password', 'New password · MyClash'],
  ['/auth/choose-password', 'Choose a password · MyClash'],
  ['/fighters', 'Fighter directory · MyClash'],
  ['/notifications', 'Notifications · MyClash'],
];

for (const [path, title] of OUTSIDE_AN_EVENT) {
  test(`${path} reads "${title}"`, async ({ page }) => {
    await stubPublicApi(page);
    await page.goto(`${PUBLIC}${path}`);

    await expect(page).toHaveTitle(title);
  });
}

test('a French visitor reads the tab in French', async ({ page, context }) => {
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  await stubPublicApi(page);

  await page.goto(`${PUBLIC}/e/test-event/live`);
  await expect(page).toHaveTitle('En direct · Open de Lyon');

  await page.goto(`${PUBLIC}/login`);
  await expect(page).toHaveTitle('Connexion · MyClash');
});
