/**
 * A bout opened with no network says "no connection", and opens by itself
 * when the network is back. It said "Match unavailable, it may have been
 * deleted or rescheduled", and stayed so: nothing read the bout again. Only a
 * live page proves what the official reads; the unit tests pin the wiring
 * (`bout-not-loaded.screens.test.ts`).
 *
 * The API is stubbed. "No network" is the answer the pad's service worker
 * gives a dead network, a 503 with `{ error: 'offline' }`, or a request that
 * gets no answer at all.
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'scheduled',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  locked_at: null,
  lice_id: null,
  end_reason: null,
  current_round: 1,
  red_round_wins: 0,
  blue_round_wins: 0,
  rounds_json: null,
  awaiting_round_advance: false,
};
const CLOCK = { status: 'idle', activeMs: 0, startedAt: null, levelResolutionSteps: 0 };

type Answer = 'bout' | 'offline' | 'gone' | 'nothing';

/** Opens the bout. Returns the switch of the bout's answer, and its count of reads. */
async function openBout(page: Page, first: Answer) {
  const state = { answer: first, reads: 0 };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/matches/${BOUT}`)) {
      state.reads += 1;
      if (state.answer === 'bout') return route.fulfill({ json: ROW });
      if (state.answer === 'gone') return route.fulfill({ status: 404, json: {} });
      if (state.answer === 'nothing') return route.abort('internetdisconnected');
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  return state;
}

const notLoaded = (page: Page) => page.getByTestId('bout-not-loaded');
const gone = (page: Page) => page.getByText(/match unavailable/i);
const clock = (page: Page) => page.getByTestId('clock-primary-button');

test('opened with no network, the bout says "no connection", not "deleted"', async ({ page }) => {
  await openBout(page, 'offline');

  await expect(notLoaded(page)).toContainText(/no connection/i);
  await expect(notLoaded(page)).toContainText(/not loaded yet/i);
  await expect(gone(page)).toHaveCount(0);
});

test('a request that gets no answer reads as "no connection" too', async ({ page }) => {
  await openBout(page, 'nothing');

  await expect(notLoaded(page)).toBeVisible();
  await expect(gone(page)).toHaveCount(0);
});

test('a bout the server does not have is still "unavailable"', async ({ page }) => {
  await openBout(page, 'gone');

  await expect(gone(page)).toBeVisible();
  await expect(notLoaded(page)).toHaveCount(0);
});

test('when the network is back, the bout opens with no tap and an empty queue', async ({
  page,
}) => {
  const state = await openBout(page, 'offline');
  await expect(notLoaded(page)).toBeVisible();
  const before = state.reads;

  state.answer = 'bout';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(clock(page)).toBeVisible();
  await expect(notLoaded(page)).toHaveCount(0);
  expect(state.reads).toBeGreaterThan(before);
});

test('wifi that got its internet back tells the browser nothing: the bout opens all the same', async ({
  page,
}) => {
  const state = await openBout(page, 'offline');
  await expect(notLoaded(page)).toBeVisible();

  // No `online` event: the tablet never left its access point.
  state.answer = 'bout';

  await expect(clock(page)).toBeVisible({ timeout: 15_000 });
  await expect(notLoaded(page)).toHaveCount(0);
});

test('Retry reads the bout again, and is the size of a finger', async ({ page }) => {
  const state = await openBout(page, 'offline');
  const retry = notLoaded(page).getByRole('button', { name: /retry/i });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const before = state.reads;

  await retry.click();
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(notLoaded(page)).toBeVisible();

  state.answer = 'bout';
  await retry.click();

  await expect(clock(page)).toBeVisible();
  await expect(notLoaded(page)).toHaveCount(0);
});

test('a bout the server lost after "no connection" says "unavailable"', async ({ page }) => {
  const state = await openBout(page, 'offline');
  await expect(notLoaded(page)).toBeVisible();

  state.answer = 'gone';
  await notLoaded(page).getByRole('button', { name: /retry/i }).click();

  await expect(gone(page)).toBeVisible();
  await expect(notLoaded(page)).toHaveCount(0);
});

test('a bout on screen stays when a later read meets no network', async ({ page }) => {
  const state = await openBout(page, 'bout');
  await expect(clock(page)).toBeVisible();
  const before = state.reads;

  state.answer = 'offline';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => state.reads).toBeGreaterThan(before);

  await expect(clock(page)).toBeVisible();
  await expect(notLoaded(page)).toHaveCount(0);
  await expect(gone(page)).toHaveCount(0);
});
