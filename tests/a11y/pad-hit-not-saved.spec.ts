/**
 * A press the tablet could not write down says so, beside the clock, and is
 * not counted. The error was kept in a state nothing read. Only a live page
 * proves the official reads it; the unit tests hold the decision
 * (`useScoringSubmit.test.ts`).
 *
 * The API is stubbed. The tablet's store is made to refuse a write the way a
 * full disk does: `add` on the `outbox` store throws.
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'running',
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
const CLOCK = {
  status: 'halted',
  activeMs: 5000,
  totalActiveMs: 5000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

/** A running bout with its clock stopped: the scoring buttons are live. */
async function openRunningBout(page: Page) {
  const sent: string[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      sent.push(`${method} ${path}`);
      // The answer of a dead network: the hit stays in the tablet's queue.
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(page.getByTestId('double-button')).toBeEnabled();
  return sent;
}

/** The store refuses every new row of the queue, or takes them again. */
async function storeRefusesWrites(page: Page, refuses: boolean) {
  await page.evaluate((on) => {
    const store = IDBObjectStore.prototype as IDBObjectStore & { realAdd?: IDBObjectStore['add'] };
    store.realAdd ??= store.add;
    const real = store.realAdd;
    store.add = function add(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (on && this.name === 'outbox') throw new DOMException('disk full', 'QuotaExceededError');
      return real.apply(this, args);
    };
  }, refuses);
}

test('a press the tablet could not write says so, and is not counted', async ({ page }) => {
  const sent = await openRunningBout(page);
  await storeRefusesWrites(page, true);

  await page.getByTestId('double-button').click();

  const alert = page.getByTestId('hit-not-saved');
  await expect(alert).toHaveText(/not saved on this tablet/i);
  await expect(alert).toHaveAttribute('role', 'alert');
  // The store's own words stay off the pad. Asked of `main`: the dev server's
  // own overlay repeats every `console.error`, and it is not the pad.
  await expect(page.locator('main').getByText(/quota|disk full/i)).toHaveCount(0);
  await expect(page.getByTestId('double-count')).toHaveAttribute('data-count', '0');
  expect(sent.filter((call) => call.endsWith('/exchanges'))).toEqual([]);
});

test('the next press that is written takes the alert away, and is counted', async ({ page }) => {
  await openRunningBout(page);
  await storeRefusesWrites(page, true);
  await page.getByTestId('double-button').click();
  await expect(page.getByTestId('hit-not-saved')).toBeVisible();

  await storeRefusesWrites(page, false);
  await page.getByTestId('double-button').click();

  await expect(page.getByTestId('double-count')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('hit-not-saved')).toHaveCount(0);
});
