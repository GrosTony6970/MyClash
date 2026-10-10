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

/** A double the server holds: the doubles count reads it. */
const DOUBLE = {
  id: 'hit-1',
  client_uuid: 'uuid-hit-1',
  sequence: 1,
  type: 'double',
  voided: false,
  occurredAt: '2026-01-01T10:00:02.000Z',
};
/** A yellow card the server holds against the red fighter. */
const YELLOW = {
  id: 'card-1',
  client_uuid: 'uuid-card-1',
  sequence: 1,
  registration_id: 'red-1',
  card: 'yellow',
  source: 'direct',
  short_name: null,
  reason: null,
  score_delta: 0,
  causes_match_forfeit: false,
  voided: false,
};

type Network = 'up' | 'down' | 'bout gone' | 'server fault' | 'no names' | 'answer lost';
interface Stub {
  network: Network;
  /** Every hit the pad sent, by its path. */
  sent: string[];
  /** The hits and the cards the server lists for the bout. */
  hits: unknown[];
  cards: unknown[];
  /** The red score of the server's row. */
  redScore: number;
}

/** The server saves red's clean hit once: a second send of the same hit changes nothing. */
function saveRedHit(stub: Stub, hit: { clientUuid: string; firstStrikeValue: number }) {
  const saved = (stub.hits as { client_uuid: string }[]).some(
    (row) => row.client_uuid === hit.clientUuid,
  );
  if (saved) return;
  stub.redScore += hit.firstStrikeValue;
  stub.hits.push({
    id: 'hit-lost',
    client_uuid: hit.clientUuid,
    sequence: 2,
    type: 'clean',
    voided: false,
    occurredAt: '2026-01-01T10:00:04.000Z',
    scoringSide: 'red',
    scoreDelta: hit.firstStrikeValue,
  });
}

/** Opens the bout with the network up, so the tablet keeps its copy. Returns the stub's switches. */
async function openBoutOnline(page: Page, lists: { hits?: unknown[]; cards?: unknown[] } = {}) {
  const stub: Stub = {
    network: 'up',
    sent: [],
    hits: lists.hits ?? [],
    cards: lists.cards ?? [],
    redScore: ROW.red_score,
  };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (stub.network === 'down') {
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    if (route.request().method() !== 'GET') {
      // The server saves red's hit and its answer never lands: the hit is in
      // the server's list and in its score, and still in the tablet's queue.
      if (stub.network === 'answer lost' && path.endsWith('/exchanges')) {
        saveRedHit(stub, route.request().postDataJSON());
        return route.abort();
      }
      if (path.endsWith('/exchanges')) stub.sent.push(path);
      return route.fulfill({ status: 201, json: { id: 'saved-1' } });
    }
    if (path.endsWith(`/matches/${BOUT}`)) {
      if (stub.network === 'bout gone') return route.fulfill({ status: 404, json: {} });
      if (stub.network === 'server fault') return route.fulfill({ status: 500, json: {} });
      return route.fulfill({ json: { ...ROW, red_score: stub.redScore } });
    }
    if (path.endsWith('/summary')) {
      // Weak wifi: the bout's row lands and its names do not.
      if (stub.network === 'no names') {
        return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
      }
      return route.fulfill({ json: SUMMARY });
    }
    if (path.endsWith('/exchanges')) return route.fulfill({ json: stub.hits });
    if (path.endsWith('/penalties')) return route.fulfill({ json: stub.cards });
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
    .poll(async () => {
      const body = (await keptRow(page, `bout/${BOUT}`)) as { redFighterName?: string } | null;
      return body ? (body.redFighterName ?? '') : null;
    })
    .toBe(redName);
}

/** How many rows the tablet's copy of a list holds. Read from the store, as `expectCopy` does. */
async function expectKeptRows(page: Page, list: 'exchanges' | 'penalties', count: number) {
  await expect
    .poll(async () => ((await keptRow(page, `${list}/${BOUT}`)) as unknown[] | null)?.length)
    .toBe(count);
}

/** The body of one row of the tablet's `reads` table, or null with no row. */
function keptRow(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (path) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve('the store did not open');
        open.onsuccess = () => {
          const get = open.result.transaction('reads').objectStore('reads').get(path);
          get.onsuccess = () => {
            const row = get.result as { body?: unknown } | undefined;
            open.result.close();
            resolve(row ? (row.body ?? '') : null);
          };
        };
      }),
    key,
  );
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
const doubles = (page: Page) => page.getByTestId('double-count');
/** The red fighter's column. Its first paragraph is the score. */
const red = (page: Page) => page.locator('[data-testid="scoring-column"][data-side="red"]');
const redYellowCards = (page: Page) => red(page).locator('[data-card="yellow"]');

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
  await expect(notice(page)).toContainText(/the hits and the cards are from that read/i);
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

test('the copy lists the hits and the cards the tablet read, under the ones it holds', async ({
  page,
}) => {
  const stub = await openBoutOnline(page, { hits: [DOUBLE], cards: [YELLOW] });
  await expect(doubles(page)).toHaveAttribute('data-count', '1');
  await expectKeptRows(page, 'exchanges', 1);
  await expectKeptRows(page, 'penalties', 1);

  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();

  await expect(doubles(page)).toHaveAttribute('data-count', '1');
  await expect(redYellowCards(page)).toHaveAttribute('data-count', '1');

  await page.getByTestId('double-button').click();

  await expect(doubles(page)).toHaveAttribute('data-count', '2');
});

test('a hit the server saved, whose answer was lost, is counted once on the copy', async ({
  page,
}) => {
  const stub = await openBoutOnline(page);
  stub.network = 'answer lost';
  await red(page).getByTestId('clean-hit-button').first().click();
  await expect.poll(() => stub.redScore).toBeGreaterThan(ROW.red_score);
  // The tablet reads the bout and its list after the send: both hold the hit.
  await expectKeptRows(page, 'exchanges', 1);
  await expect
    .poll(async () => ((await keptRow(page, `bout/${BOUT}`)) as { redScore: number }).redScore)
    .toBe(stub.redScore);

  // The hit is in the tablet's copy of the score, in its list AND in its queue.
  await reload(page, stub, 'down');
  await expect(notice(page)).toBeVisible();

  await expect(red(page).locator('p').first()).toHaveText(String(stub.redScore));
  await expect(red(page).getByTestId('provisional-score')).toHaveCount(0);
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
