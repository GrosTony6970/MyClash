/**
 * The sync bar's buttons are touch targets (quick win P11; operator,
 * 2026-10-12).
 *
 * A hit is refused, and the bar turns red with "Review" and "Retry". Each was
 * about 20px tall: the one button that recovers the entries not sent was the
 * hardest to hit. The bar now grows to 44px when it has a button, and stays a
 * thin line when all is well.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The bar centres its children, so
 * no neighbour stretches a button: its height is its own.
 */
import { test, expect, type Page } from '@playwright/test';
import { held, openBout, primary } from './pad-clock-stub';

const bar = (page: Page) => page.getByTestId('network-bar');
const height = async (page: Page) => (await bar(page).boundingBox())?.height ?? 0;

test('the bar is a thin line while it has no button, and 44px once it has one', async ({
  page,
}) => {
  const stub = await openBout(page);
  await expect(bar(page)).toHaveAttribute('data-sync', 'online');
  await expect(bar(page).getByRole('button')).toHaveCount(0);
  expect(await height(page)).toBeLessThanOrEqual(28);

  stub.refuseNext = 'clock_press_out_of_order';
  await primary(page).click();
  await expect(held(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('data-sync', 'error');

  const buttons = bar(page).getByRole('button');
  await expect(page.getByTestId('review-refused')).toBeVisible();
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  // The buttons take back the bar's own padding: the bar is 44px, not 52.
  expect(await height(page)).toBe(44);
});
