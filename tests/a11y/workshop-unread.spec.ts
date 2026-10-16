/**
 * A Workshop's page whose read failed says it could not load, and offers Retry.
 *
 * Any answer that was not the Workshop read "Workshop not found": a server that was down for a
 * moment told a guest her Workshop did not exist. Only a 404 says that now.
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

const WORKSHOP = '**/api/v1/workshops/slug/sword-basics*';

async function openWorkshop(page: Page, status: number) {
  const reads = { count: 0, well: false };
  await stubPublicApi(page);
  await page.route(WORKSHOP, (route) => {
    reads.count += 1;
    // Well again: an answer the page cannot draw keeps the story on the failure's way out.
    return reads.well
      ? route.fulfill({ status: 404, json: { detail: 'gone' } })
      : route.fulfill({ status, json: { detail: 'down' } });
  });
  await page.goto(`${PUBLIC}/e/test-event/w/sword-basics`);
  await waitForPageMain(page);
  return reads;
}

test('a read the server failed says "could not load", and Retry reads again', async ({ page }) => {
  const reads = await openWorkshop(page, 503);

  await expect(
    page.getByRole('heading', { name: 'We could not load this workshop' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workshop not found' })).toHaveCount(0);

  const before = reads.count;
  reads.well = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Workshop not found' })).toBeVisible();
  expect(reads.count).toBeGreaterThan(before);
});

test('a Workshop the server does not know is "not found", with no Retry', async ({ page }) => {
  await openWorkshop(page, 404);

  await expect(page.getByRole('heading', { name: 'Workshop not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
});
