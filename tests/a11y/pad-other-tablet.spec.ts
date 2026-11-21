/**
 * Two tablets on one piste (ruling 953). Two volunteers opened the pad for the
 * same piste and both scored its bout: nothing told them, and a clock press of
 * one that met the other's went to Review. The pad's check-in now says which
 * piste it has open, and the server answers how many other tablets it heard
 * from there in the last minute. The pad warns; it blocks nothing.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The check-in's route is registered
 * after the stub, and wins; the page is loaded again so its first check-in,
 * sent as soon as the bout names its piste, meets that route.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, primary } from './pad-clock-stub';
import { expectNoCriticalAxeViolations } from './helpers';

const banner = (page: Page) => page.getByTestId('other-tablet-banner');

async function openWithOthers(page: Page, others: number) {
  await openBout(page, { row: { lice_id: 'lice-1' } });
  const beats: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/staff/heartbeat', (route) => {
    beats.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { ok: true, otherTablets: others } });
  });
  await page.reload();
  await expect(primary(page)).toBeEnabled();
  return beats;
}

test('a bout another tablet also scores says so, and the check-in names the piste', async ({
  page,
}) => {
  const beats = await openWithOthers(page, 1);

  await expect(banner(page)).toHaveText(
    'Another tablet is scoring this piste. Keep one tablet per piste: a clock press may go to Review.',
  );
  expect(beats.some((beat) => beat['liceId'] === 'lice-1')).toBe(true);
  // A warning, not a lock: the clock is still there to press.
  await expect(primary(page)).toBeEnabled();
  await expectNoCriticalAxeViolations(page);
});

test('a bout no other tablet scores says nothing', async ({ page }) => {
  const beats = await openWithOthers(page, 0);

  await expect.poll(() => beats.some((beat) => beat['liceId'] === 'lice-1')).toBe(true);
  await expect(banner(page)).toHaveCount(0);
});
