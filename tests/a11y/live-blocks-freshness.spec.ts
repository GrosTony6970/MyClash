/**
 * The Event home's "Live now" and the display hub's "Now live" say how fresh they are.
 *
 * Both read the Event's live state on their own and kept the last picture when a read
 * failed, saying nothing: a frozen score looked like a live one (quick win F5's fault, in
 * two more places). They now read through the live board's reader (`useLiveBoard`) and show
 * its chip. It says nothing while the channel is live; here the channel is down (nothing
 * answers it), so the blocks read by their poll and say so.
 *
 * Both pages read on the SERVER first (`scripts/e2e-server-api-stub.mjs`); the browser's
 * reads are answered here, and a story can stop them landing.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { boardBout, liveState, PUBLIC } from './public-pages-stub';

const PISTE_1 = liveState([
  {
    lice: { id: 'lice-1', name: 'Piste 1', sortOrder: 1 },
    runningMatch: boardBout('M01'),
    nextMatch: null,
  },
]);

/** The browser's live-state reads, as a story fails and counts them. */
async function open(page: Page, path: string) {
  const reads = { down: false, count: 0 };
  // The page's own clock, so the story does not wait three polls of thirty seconds.
  await page.clock.install({ time: new Date('2027-06-12T08:00:00.000Z') });
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event/live-state', (route) => {
    reads.count += 1;
    return reads.down ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: PISTE_1 });
  });
  await page.goto(`${PUBLIC}${path}`);
  await waitForPageMain(page);
  return reads;
}

/** The block's chip. The channel says it is down after a moment, so the first wait is long. */
const chipOf = (page: Page, heading: string) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    .getByRole('status');

for (const [where, path, heading] of [
  ['the Event home', '/e/test-event/home', 'Live now'],
  ['the display hub', '/e/test-event/display', 'Now live'],
] as const) {
  test(`${where}: the live block says its updates are slower, then that it is not updating`, async ({
    page,
  }) => {
    const reads = await open(page, path);
    const chip = chipOf(page, heading);
    await expect(chip).toHaveText('Slower updates', { timeout: 20_000 });

    // The server stops answering. Three polls later nothing has landed.
    reads.down = true;
    const before = reads.count;
    await page.clock.fastForward(95_000);
    await expect(chip).toHaveText('Not updating');
    expect(reads.count).toBeGreaterThan(before);
    // The last good picture stays on screen.
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

    // The server answers again: the next poll lands.
    reads.down = false;
    await page.clock.fastForward(31_000);
    await expect(chip).toHaveText('Slower updates');
    await expectNoCriticalAxeViolations(page);
  });
}

// The home draws the server's picture first. A phone that loses the network right after
// never lands a read of its own: the picture it shows is as old as the page.
test('the Event home: a picture the server drew, and no read after it, comes to say it is not updating', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2027-06-12T08:00:00.000Z') });
  await stubPublicApi(page);
  let reads = 0;
  await page.route('**/api/v1/events/test-event/live-state', (route) => {
    reads += 1;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto(`${PUBLIC}/e/test-event/home`);
  await waitForPageMain(page);
  const chip = chipOf(page, 'Live now');
  await expect(chip).toHaveText('Slower updates', { timeout: 20_000 });

  await page.clock.fastForward(95_000);
  await expect(chip).toHaveText('Not updating');
  expect(reads).toBeGreaterThan(0);
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
});
