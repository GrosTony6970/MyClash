/**
 * The controls of the bout header are touch targets, and the theme is one
 * button (quick win P12; operator, 2026-10-12).
 *
 * The header had three theme symbols of about 16px each, and Back, "Match
 * actions" and "External display" under 44px. The theme is now one 44px button
 * that goes to the next theme at each tap, and says the theme it shows.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The header's columns do not
 * stretch their children, so each height is the control's own.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openBout, primary } from './pad-clock-stub';

const theme = (page: Page) => page.getByTestId('theme-switcher');
const header = (page: Page) => page.locator('header');

async function expectTarget(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
}

test('Back, Match actions, External display and the theme button are 44px', async ({ page }) => {
  await openBout(page);
  await page.goto('http://localhost:3002/matches/match-1?externalDisplay=/display/match-1');
  await expect(primary(page)).toBeEnabled();

  await expectTarget(header(page).getByRole('link', { name: /back to match list/i }));
  await expectTarget(page.getByTestId('open-corrections'));
  await expectTarget(header(page).getByRole('button', { name: /external display/i }));
  await expectTarget(theme(page));
  // One button, not three.
  await expect(header(page).locator('[data-theme-option]')).toHaveCount(0);
});

test('the theme button goes to the next theme at each tap, and says the one it shows', async ({
  page,
}) => {
  await openBout(page);

  // A tablet that never chose: the dark pad under a light header.
  await expect(theme(page)).toHaveAttribute('data-theme-mode', 'hybrid');
  await expect(theme(page)).toHaveText(/hybrid/i);
  await expect(theme(page)).toHaveAccessibleName('Colour theme: Hybrid. Change to Dark.');
  await expect(header(page)).toHaveAttribute('data-theme', 'light');

  await theme(page).click();
  await expect(theme(page)).toHaveAttribute('data-theme-mode', 'dark');
  await expect(theme(page)).toHaveText(/dark/i);
  await expect(header(page)).toHaveAttribute('data-theme', 'dark');

  await theme(page).click();
  await expect(theme(page)).toHaveAttribute('data-theme-mode', 'light');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');

  await theme(page).click();
  await expect(theme(page)).toHaveAttribute('data-theme-mode', 'hybrid');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
});
