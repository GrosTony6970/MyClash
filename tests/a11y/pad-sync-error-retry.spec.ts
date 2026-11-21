/**
 * SYNC ERROR tries again by itself (ruling 954). A hit the server answered with
 * a fault (a 500, not a refusal) waited for the referee's Retry, another hit or
 * another bout: on a tablet nobody touched, for ever. Now the pad tries again
 * after 5 s, then 10, 20, 40, and a minute at most; the bar keeps its words,
 * and its Retry still sends at once.
 *
 * The API is stubbed (`pad-clock-stub.ts`); the story's route for the hit is
 * registered after it, and wins. The waits are `offline/retry-after-error.ts`.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, primary, redHit, status } from './pad-clock-stub';

const bar = (page: Page) => page.getByTestId('network-bar');

test('a hit the server answered with a fault is sent again with no tap once it answers', async ({
  page,
}) => {
  const stub = await openBout(page);
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);

  let healthy = false;
  let faults = 0;
  await page.route('**/exchanges', (route) => {
    if (route.request().method() !== 'POST' || healthy) return route.fallback();
    faults += 1;
    return route.fulfill({ status: 500, json: { statusCode: 500, message: 'Internal error' } });
  });

  await redHit(page).first().click();
  await expect.poll(() => faults).toBeGreaterThanOrEqual(1);
  await expect(bar(page)).toHaveAttribute('data-sync', 'error');
  await expect(bar(page)).toHaveAttribute('data-pending', '1');

  healthy = true;

  // No tap: the first try comes 5 s after the error.
  await expect.poll(() => stub.sent, { timeout: 9_000 }).toContain('POST /exchanges');
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
  await expect(bar(page)).toHaveAttribute('data-sync', 'online');
});
