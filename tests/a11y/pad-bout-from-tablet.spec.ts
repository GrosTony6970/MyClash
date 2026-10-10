/**
 * A bout the tablet has read opens with no network, from the tablet's copy
 * (operator rulings 3, 9 and 10 of the quick-win list). The official reloads
 * the pad in a hall with no wifi: the screen said "not loaded yet" and the
 * table could not score. Now the bout screen opens, says that it shows the
 * tablet's copy and from when, and takes hits into the queue. The server's
 * answer replaces the copy. Only a live page proves what the official reads;
 * the unit tests hold the read and the copy (`bout-read.test.ts`,
 * `kept-bout.test.ts`).
 *
 * The API is stubbed. A dead network is the answer the pad's service worker
 * gives: a 503 with `{ error: 'offline' }`. The tablet's store lives through a
 * reload, as it does on a real tablet.
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
  red_score: 3,
  blue_score: 2,
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
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  tournamentId: 'tournament-1',
  phaseType: 'pool',
  bestOf: 1,
};
const CLOCK = {
  status: 'halted',
  activeMs: 5000,
  totalActiveMs: 5000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

type Network = 'up' | 'down' | 'bout gone' | 'server fault' | 'no names';
interface Stub {
  network: Network;
  /** Every hit the pad sent, by its path. */
  sent: string[];
}

/** Opens the bout with the network up, so the tablet keeps its copy. Returns the stub's switches. */
async function openBoutOnline(page: Page) {
  const stub: Stub = { network: 'up', sent: [] };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (stub.network === 'down') {
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    if (route.request().method() !== 'GET') {
      if (path.endsWith('/exchanges')) stub.sent.push(path);
      return route.fulfill({ status: 201, json: { id: 'saved-1' } });
    }
    if (path.endsWith(`/matches/${BOUT}`)) {
      if (stub.network === 'bout gone') return route.fulfill({ status: 404, json: {} });
      if (stub.network === 'server fault') return route.fulfill({ status: 500, json: {} });
      return route.fulfill({ json: ROW });
    }
    if (path.endsWith('/summary')) {
      // Weak wifi: the bout's row lands and its names do not.
      if (stub.network === 'no names') {
        return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
      }
      return route.fulfill({ json: SUMMARY });
    }
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(page.getByTestId('double-button')).toBeEnabled();
  await expect(notice(page)).toHaveCount(0);
  await expectCopy(page, 'Ana Red');
  return stub;
}

/**
 * The red fighter's name in the tablet's copy of the bout, or null with no
 * copy. Read from the store itself: the page writes and removes a copy behind
 * the screen, and a reload must not race that write.
 */
async function expectCopy(page: Page, redName: string | null) {
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          new Promise<string | null>((resolve) => {
            const open = indexedDB.open('myclash-staff');
            open.onerror = () => resolve('the store did not open');
            open.onsuccess = () => {
              const store = open.result.transaction('reads').objectStore('reads');
              const get = store.get(key);
              get.onsuccess = () => {
                const row = get.result as { body?: { redFighterName?: string } } | undefined;
                open.result.close();
                resolve(row ? (row.body?.redFighterName ?? '') : null);
              };
            };
          }),
        `bout/${BOUT}`,
      ),
    )
    .toBe(redName);
}

/** The pad is loaded again with the network as `network` says. */
async function reload(page: Page, stub: Stub, network: Network) {
  stub.network = network;
  await page.reload();
}

/** The network is back: the browser tells the page. */
async function comeBackOnline(page: Page, stub: Stub, network: Network = 'up') {
  stub.network = network;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

const notice = (page: Page) => page.getByTestId('bout-from-tablet');
const main = (page: Page) => page.locator('main');
const clock = (page: Page) => page.getByTestId('clock-status');

test('with no network, a reloaded pad opens the bout from the tablet and says so', async ({
  page,
}) => {
  const stub = await openBoutOnline(page);

  await reload(page, stub, 'down');

  await expect(main(page).getByText('Ana Red').first()).toBeVisible();
  await expect(main(page).getByText('Bo Blue').first()).toBeVisible();
  await expect(notice(page)).toHaveAttribute('role', 'status');
  await expect(notice(page)).toContainText(/no connection/i);
  await expect(notice(page)).toContainText(/as this tablet read it on/i);
  await expect(notice(page)).toContainText(/hits and cards from before are not listed/i);
  // The DATE of the copy is said, not only its hour: a copy can be a week old.
  const now = new Date();
  await expect(notice(page)).toContainText(now.toLocaleDateString('en', { weekday: 'long' }));
  await expect(notice(page)).toContainText(now.toLocaleDateString('en', { month: 'long' }));
  await expect(page.getByTestId('score-unconfirmed')).toHaveCount(2);
  await expect(page.getByTestId('bout-not-loaded')).toHaveCount(0);
});

test('a hit is taken on the copy, and waits in the queue', async ({ page }) => {
  const stub = await openBoutOnline(page);
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();

  await page.getByTestId('double-button').click();

  await expect(page.getByTestId('double-count')).toHaveAttribute('data-count', '1');
  // The copy stays: the read that follows the send finds no network either.
  await expect(notice(page)).toBeVisible();
  await expect(main(page).getByText('Ana Red').first()).toBeVisible();
  expect(stub.sent).toEqual([]);
});

test('when the network is back, the server’s bout replaces the copy with no tap', async ({
  page,
}) => {
  const stub = await openBoutOnline(page);
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();
  // The copy's screen shows the clock the tablet kept with the bout.
  await expect(clock(page)).toHaveAttribute('data-status', 'halted');

  await comeBackOnline(page, stub);

  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByTestId('score-unconfirmed')).toHaveCount(0);
  await expect(main(page).getByText('Ana Red').first()).toBeVisible();
  // The server's screen reads the server's clock again.
  await expect(clock(page)).toHaveAttribute('data-status', 'halted');
});

test('the pad asks again by itself while it shows the copy', async ({ page }) => {
  const stub = await openBoutOnline(page);
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();

  // No `online` event: the access point stayed up and the uplink came back.
  stub.network = 'up';

  // Inside 10 seconds: the page asks every 5. The pad's other timer (it settles
  // remembered undos every 15 seconds) also reads the bout, and must not be
  // what passes this test.
  await expect(notice(page)).toHaveCount(0, { timeout: 10_000 });
});

test('when the server’s bout replaces the copy, the pad sends what it holds', async ({ page }) => {
  const stub = await openBoutOnline(page);
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();
  await page.getByTestId('double-button').click();
  await expect(page.getByTestId('double-count')).toHaveAttribute('data-count', '1');

  // No `online` event: the access point stayed up and the uplink came back.
  stub.network = 'up';

  await expect(notice(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(clock(page)).toHaveAttribute('data-status', 'halted');
  await expect.poll(() => stub.sent).toEqual([`/api/v1/matches/${BOUT}/exchanges`]);
});

test('a bout the server says is gone leaves the screen, and its copy opens no more', async ({
  page,
}) => {
  const stub = await openBoutOnline(page);
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();

  await comeBackOnline(page, stub, 'bout gone');
  await expect(main(page).getByText(/match unavailable/i)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await expectCopy(page, null);

  await reload(page, stub, 'down');
  await expect(page.getByTestId('bout-not-loaded')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

test('a server fault does not open the copy, and does not remove it', async ({ page }) => {
  const stub = await openBoutOnline(page);

  await reload(page, stub, 'server fault');
  await expect(main(page).getByText(/match unavailable/i)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  // The server is restarting and the hall's wifi drops: the copy is still there.
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();
  await expect(main(page).getByText('Ana Red').first()).toBeVisible();
});

test('a bout read without its names does not replace a copy that has them', async ({ page }) => {
  const stub = await openBoutOnline(page);

  // The bout opens with blank names, from the server: that read is shown, not kept.
  await reload(page, stub, 'no names');
  await expect(page.getByTestId('double-button')).toBeEnabled();
  await expect(notice(page)).toHaveCount(0);
  await expect(main(page).getByText('Ana Red')).toHaveCount(0);
  await expectCopy(page, 'Ana Red');

  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();
  await expect(main(page).getByText('Ana Red').first()).toBeVisible();
});
