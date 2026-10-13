/**
 * The piste list has the full sync bar (quick win P16; operator, 2026-10-12).
 *
 * Bout 4 ends with entries not sent. The official goes back to the piste list,
 * which showed "online" and no count, and sent nothing. Now the piste list
 * counts the entries not sent and the refused ones, sends the queue when the
 * screen opens and when the network is back, tries again by itself, and offers
 * Retry and the inbox of refused entries.
 *
 * The API is stubbed (`pad-clock-stub.ts`). Each story puts an entry in the
 * tablet's queue on the bout screen, then opens the piste list as a new page:
 * the queue is the tablet's own store, and stays.
 */
import { test, expect, type Page } from '@playwright/test';
import { held, openBout, primary, redHit } from './pad-clock-stub';

const PAD = 'http://localhost:3002';
const PISTE = 'piste-1';
const OFFLINE = { status: 503, json: { error: 'offline', status: 503 } };
type Stub = Awaited<ReturnType<typeof openBout>>;

const bar = (page: Page) => page.getByTestId('network-bar');

/** A bout with its clock paused: a hit can be given. */
async function pausedBout(page: Page) {
  const stub = await openBout(page);
  // The piste's own list, which the bout's stub does not know.
  await page.route(`**/staff/lices/${PISTE}/matches`, (route) =>
    stub.network === 'down'
      ? route.fulfill(OFFLINE)
      : route.fulfill({ json: { liceId: PISTE, liceName: 'Piste One', matches: [] } }),
  );
  await primary(page).click();
  await expect(primary(page)).toHaveAttribute('data-action', 'halt');
  await primary(page).click();
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  return stub;
}

/** One hit given with no network: it waits on the tablet. */
async function hitNotSent(page: Page, stub: Stub) {
  stub.network = 'down';
  await redHit(page).first().click();
  await expect(page.getByTestId('provisional-score')).toBeVisible();
  await expect(bar(page)).toHaveAttribute('data-pending', '1');
}

const openPiste = (page: Page) => page.goto(`${PAD}/lices/${PISTE}`);
const HIT_SENT = ['POST /clock start', 'POST /clock halt', 'POST /exchanges'];

test('the piste list counts the entries not sent, and sends them when the network is back', async ({
  page,
}) => {
  const stub = await pausedBout(page);
  await hitNotSent(page, stub);

  await openPiste(page);
  await expect(bar(page)).toHaveCount(1);
  await expect(bar(page)).toHaveAttribute('data-sync', 'offline');
  await expect(bar(page)).toHaveAttribute('data-pending', '1');
  await expect(bar(page)).toContainText('(1)');
  expect(stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);

  // The network is back, and the browser says so.
  stub.network = 'up';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Within 2 seconds: the try the list makes by itself comes 5 seconds after
  // the first send, and must not be what sends this.
  await expect.poll(() => stub.sent, { timeout: 2_000 }).toEqual(HIT_SENT);
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
  await expect(bar(page)).toHaveAttribute('data-sync', 'online');
});

test('the piste list sends the queue when it opens', async ({ page }) => {
  const stub = await pausedBout(page);
  await hitNotSent(page, stub);

  // The network came back while nobody looked: no event, no bout screen.
  stub.network = 'up';
  await openPiste(page);

  await expect.poll(() => stub.sent).toEqual(HIT_SENT);
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
  await expect(page.getByTestId('lice-title')).toHaveText('Piste One');
});

test('the piste list tries again by itself while the queue waits for a network', async ({
  page,
}) => {
  const stub = await pausedBout(page);
  await hitNotSent(page, stub);
  await openPiste(page);
  await expect(bar(page)).toHaveAttribute('data-sync', 'offline');
  await expect(bar(page)).toHaveAttribute('data-pending', '1');

  // The uplink is back and the tablet kept its access point: no event at all.
  stub.network = 'up';

  await expect.poll(() => stub.sent, { timeout: 12_000 }).toEqual(HIT_SENT);
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
});

// Operator, 2026-10-13. The bar went grey ("offline") over a refused entry, as
// if nothing needed the official.
test('a refused entry with no network: the bar is red, says both, and offers Review alone', async ({
  page,
}) => {
  const stub = await pausedBout(page);
  stub.refuseNextHit = 'match_locked';
  await redHit(page).first().click();
  await expect(held(page)).toContainText(/this bout is locked/i);

  // The browser itself says there is no network, from the next page on.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  });
  stub.network = 'down';
  await openPiste(page);

  await expect(bar(page)).toHaveAttribute('data-sync', 'offline');
  await expect(bar(page)).toHaveAttribute('data-rejected', '1');
  await expect(bar(page)).toHaveClass(/text-danger/);
  await expect(bar(page)).toContainText(/not recorded.*no connection/i);
  await expect(page.getByTestId('review-refused')).toBeVisible();
  await expect(bar(page).getByRole('button', { name: /retry/i })).toHaveCount(0);
});

test('a refused entry is said on the piste list, and its inbox opens there', async ({ page }) => {
  const stub = await pausedBout(page);
  stub.refuseNextHit = 'match_locked';
  await redHit(page).first().click();
  await expect(held(page)).toContainText(/this bout is locked/i);

  await openPiste(page);
  await expect(bar(page)).toHaveAttribute('data-sync', 'error');
  await expect(bar(page)).toHaveAttribute('data-rejected', '1');
  await expect(bar(page)).toContainText(/not recorded/i);

  const review = page.getByTestId('review-refused');
  expect((await review.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await review.click();
  await expect(page.getByTestId('quarantine-row')).toHaveCount(1);
});
