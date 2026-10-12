/**
 * The offline drill, and a hall with wifi and no internet (operator, 2026-10-12).
 *
 * The drill was written when the tablet's queue held hits only. Since then a
 * whole bout runs on the tablet, and the drill fell behind it: its bar was red
 * "SYNC ERROR" over one or two entries, nothing was sent when it ended, and an
 * undo or a correction made during a drill reached the server for real.
 *
 * The API is stubbed (`pad-clock-stub.ts`). Each story registers one more
 * route AFTER the stub, which wins: it records every write the pad makes, so a
 * request the stub would answer in silence (a correction, a void) is seen.
 * The engine's side is `offline/sync.no-network.test.ts` and
 * `offline/drill-request.test.ts`; the census of the pad's requests is
 * `offline/drill-census.test.ts`.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, primary, redHit, status } from './pad-clock-stub';

const DRILL_KEY = 'myclash.staff.offlineDrill.v1';
const NO_CONNECTION = 'No connection. This needs the network — try again once you are back online.';

const bar = (page: Page) => page.getByTestId('network-bar');
const banner = (page: Page) => page.getByTestId('offline-drill-banner');
const queuedHit = (page: Page) =>
  page.locator('[data-testid="scoring-column"][data-side="red"]').getByTestId('provisional-score');

/** Every write the pad makes from now on, as `POST /clock`. Registered after the stub: it sees them first. */
async function recordWrites(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const heartbeat = path.endsWith('/staff/heartbeat');
    if (request.method() !== 'GET' && !heartbeat) {
      writes.push(`${request.method()} ${path.replace(/^.*\/match-1/, '')}`);
    }
    return route.fallback();
  });
  return writes;
}

/** Start, Pause, two hits for red: a bout in play, with four entries on the tablet. */
async function startPauseTwoHits(page: Page): Promise<void> {
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await redHit(page).first().click();
  await expect(queuedHit(page)).toHaveAttribute('data-provisional-delta', '2');
  await redHit(page).first().click();
  await expect(queuedHit(page)).toHaveAttribute('data-provisional-delta', '4');
}

test('a drill holds every press of the bout on the tablet, and its end sends them with no tap', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, String(Date.now() + 120_000));
  }, DRILL_KEY);
  const stub = await openBout(page);
  const writes = await recordWrites(page);
  await expect(banner(page)).toContainText('Entries are queued, not lost.');

  await startPauseTwoHits(page);
  // Grey "offline", with four entries as with one: never the red "sync error".
  await expect(bar(page)).toHaveAttribute('data-sync', 'offline');
  await expect(bar(page)).toHaveAttribute('data-pending', '4');

  // The undo works on the tablet alone: the second hit leaves the screen.
  await page.getByTestId('undo-last-entry').click();
  await expect(queuedHit(page)).toHaveAttribute('data-provisional-delta', '2');

  // A correction that needs the server answers as a dead network does.
  await page.getByTestId('open-corrections').click();
  await page.getByRole('button', { name: 'Swap fighter color' }).click();
  await expect(page.getByText(NO_CONNECTION)).toBeVisible();

  // Nothing of all that left the tablet.
  expect(writes).toEqual([]);
  expect(stub.arrived).toEqual([]);

  // The drawer is closed first: with it open, a click on the banner does not land.
  await page.keyboard.press('Escape');
  // The bout page tries a queue that waits again by itself, on a browser that
  // says it is online. It is stood still here, so what follows is the END of
  // the drill sending, and not that retry a few seconds later.
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false });
  });
  await banner(page).getByRole('button', { name: 'End drill' }).click();

  // The bout goes to the server in its own order, with no further tap: the hit
  // the undo took back is not in it.
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /clock start', 'POST /clock halt', 'POST /exchanges']);
  expect(writes).toEqual(['POST /clock', 'POST /clock', 'POST /exchanges']);
  await expect(banner(page)).toHaveCount(0);
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
  await expect(bar(page)).toHaveAttribute('data-sync', 'online');
});

test('wifi with no internet: one unsent hit reads as offline, and goes by itself when the server answers', async ({
  page,
}) => {
  const stub = await openBout(page);
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);

  // The server is out of reach for a hit, as the pad's service worker says it.
  // The browser still says "online", and the reads go: no `online` event will come.
  let reachable = false;
  let tries = 0;
  await page.route('**/exchanges', (route) => {
    if (route.request().method() !== 'POST' || reachable) return route.fallback();
    tries += 1;
    return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
  });

  await redHit(page).first().click();
  await expect.poll(() => tries).toBe(1);
  await expect(bar(page)).toHaveAttribute('data-network', 'online');
  await expect(bar(page)).toHaveAttribute('data-sync', 'offline');
  await expect(bar(page)).toHaveAttribute('data-pending', '1');
  // Nothing for the operator to do: no Retry, and the tablet tries by itself.
  await expect(bar(page).getByRole('button')).toHaveCount(0);

  reachable = true;

  await expect.poll(() => stub.sent, { timeout: 9_000 }).toContain('POST /exchanges');
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
  await expect(bar(page)).toHaveAttribute('data-sync', 'online');
});
