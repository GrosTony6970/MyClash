/**
 * The tablet does not hand a downward swipe to the browser (quick win P8;
 * operator, 2026-10-12: every screen of the pad).
 *
 * A finger that dragged down from the top of the bout screen reloaded the
 * page in the middle of a bout. The browser reads `overscroll-behavior` off
 * the root scroller, which on the pad is the document: so the rule is asked of
 * the root and of the body, on the bout screen and on the sign-in screen
 * (another route of the same app, to hold "every screen").
 *
 * A browser cannot be made to pull-to-refresh in a test; the computed style is
 * what it reads.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout } from './pad-clock-stub';

const overscroll = (page: Page) =>
  page.evaluate(() => ({
    root: getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(document.body).overscrollBehaviorY,
  }));

test('the bout screen does not hand a downward swipe to the browser', async ({ page }) => {
  await openBout(page);

  expect(await overscroll(page)).toEqual({ root: 'none', body: 'none' });
});

test('nor does another screen of the tablet', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.goto('http://localhost:3002/login');

  expect(await overscroll(page)).toEqual({ root: 'none', body: 'none' });
});
