/**
 * The piste's bout list, opened with no network: the screen says "no
 * connection". It said "Loading" for ever, because the read was skipped before
 * the `try` whose `finally` ends the loading. Only a live page proves what the
 * official reads; the unit tests hold the decision (`useLiceMatches.test.ts`).
 *
 * The API is stubbed. "No network" is either the browser saying so
 * (`navigator.onLine`, set by an init script) or the answer the pad's service
 * worker gives a dead network: a 503 with `{ error: 'offline' }`.
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const LICE = 'lice-1';
const LIST = { liceId: LICE, liceName: 'Piste Seven', matches: [] };
const NO_CONNECTION = /no connection/i;

type Answer = 'list' | 'offline' | 'broken';

/** Opens the piste. Returns the switch of the list's answer, and its count of reads. */
async function openPiste(page: Page, first: Answer, online = true) {
  const state = { answer: first, reads: 0 };
  await page.addInitScript((isOnline) => {
    (window as unknown as { padOnline: boolean }).padOnline = isOnline;
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => (window as unknown as { padOnline: boolean }).padOnline,
    });
  }, online);
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith(`/staff/lices/${LICE}/matches`)) {
      return route.fulfill({ status: 404, json: {} });
    }
    state.reads += 1;
    if (state.answer === 'list') return route.fulfill({ json: LIST });
    if (state.answer === 'offline') {
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    return route.fulfill({ status: 500, json: { detail: 'boom' } });
  });
  await page.goto(`${PAD}/lices/${LICE}`);
  return state;
}

/** The network comes back: the browser says so, and tells the page. */
async function comeBackOnline(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { padOnline: boolean }).padOnline = true;
    window.dispatchEvent(new Event('online'));
  });
}

test('opened with no network, the piste says "no connection" and asks nothing', async ({
  page,
}) => {
  const state = await openPiste(page, 'list', false);

  await expect(page.getByTestId('lice-unreachable')).toHaveText(NO_CONNECTION);
  await expect(page.getByText(/loading/i)).toHaveCount(0);
  await expect(page.getByText(/no next match/i)).toHaveCount(0);
  expect(state.reads).toBe(0);
});

test('when the network is back, the list is read with no tap', async ({ page }) => {
  const state = await openPiste(page, 'list', false);
  await expect(page.getByTestId('lice-unreachable')).toBeVisible();

  await comeBackOnline(page);

  await expect(page.getByText('Piste Seven')).toBeVisible();
  await expect(page.getByText(/no next match/i)).toBeVisible();
  await expect(page.getByTestId('lice-unreachable')).toHaveCount(0);
  expect(state.reads).toBeGreaterThan(0);
});

test('wifi with no internet reads as "no connection" too', async ({ page }) => {
  await openPiste(page, 'offline');

  await expect(page.getByTestId('lice-unreachable')).toHaveText(NO_CONNECTION);
});

test('a list already on screen stays when the network goes', async ({ page }) => {
  const state = await openPiste(page, 'list');
  await expect(page.getByText('Piste Seven')).toBeVisible();
  const before = state.reads;

  state.answer = 'offline';
  await comeBackOnline(page);
  await expect.poll(() => state.reads).toBeGreaterThan(before);

  await expect(page.getByText('Piste Seven')).toBeVisible();
  await expect(page.getByText(/no next match/i)).toBeVisible();
  await expect(page.getByTestId('lice-unreachable')).toHaveCount(0);
});

test('a server that fails is not called "no connection"', async ({ page }) => {
  const state = await openPiste(page, 'broken');
  await expect.poll(() => state.reads).toBeGreaterThan(0);

  await expect(page.getByText(/loading/i)).toHaveCount(0);
  await expect(page.getByTestId('lice-unreachable')).toHaveCount(0);
});
