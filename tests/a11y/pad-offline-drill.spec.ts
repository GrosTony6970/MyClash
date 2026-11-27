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
import { comeBackOnline, openBout, primary, redHit, status, TEAM_BOUT } from './pad-clock-stub';

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

/** A penalty list of one entry, a yellow card at its first offence. */
const PENALTY_LIST = {
  id: 'cards-1',
  name: 'Cards',
  accumulation_scope: 'match',
  yellow_card_points: 0,
  red_card_points: 1,
  black_card_points: 0,
  penalty_ruleset_entries: [
    {
      id: 'entry-1',
      group_number: 1,
      ref_number: '1',
      short_name: 'Leaving the ring',
      description: 'Left the ring',
      sanctions: ['yellow'],
    },
  ],
};

/** The team bout after this one on the piste, as `GET /matches/:id/neighbors` gives it. */
const NEXT_TEAMS = {
  id: 'match-2',
  matchNumberLabel: 'L1-P1-M2',
  roundCode: 'L1-P1-M2',
  redFighterName: 'Nice Foils',
  blueFighterName: 'Metz Sabres',
  redClub: null,
  blueClub: null,
  redColour: 'orange',
  blueColour: 'yellow',
};

/**
 * Lyon Blades fight Paris Rapiers on a team Pool's piste, and the hall's wifi drops. The
 * scorekeeper starts the Match, cards Lyon from the penalty list and Paris from the corrections
 * drawer, and the network comes back. Each card reaches the server on its team: a team has no
 * Registration, and a card that named one was refused, or never queued.
 */
test('a team bout: cards given with no network reach the server on their teams', async ({
  page,
}) => {
  const stub = await openBout(page, {
    ...TEAM_BOUT,
    penaltyRuleset: PENALTY_LIST,
    neighbors: { previous: null, next: NEXT_TEAMS },
  });
  // Each team's colour chip beside its name in the header (green and purple).
  await expect(page.locator('header .bg-green-700')).toHaveCount(1);
  await expect(page.locator('header .bg-purple-700')).toHaveCount(1);
  // And on the "next" tile: Nice Foils (orange) against Metz Sabres (yellow).
  const nextTile = page.getByRole('link', { name: /Nice Foils/ });
  await expect(nextTile.locator('.bg-orange-600')).toHaveCount(1);
  await expect(nextTile.locator('.bg-yellow-400')).toHaveCount(1);
  const redColumn = page.locator('[data-testid="scoring-column"][data-side="red"]');
  await expect(redColumn.getByTestId('penalty-entry-button')).toHaveCount(1);

  stub.network = 'down';
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');

  // A card of the list for Lyon: a yellow is given at the tap.
  await redColumn.getByTestId('penalty-entry-button').click();
  await expect(redColumn.getByTestId('provisional-score')).toHaveAttribute(
    'data-queued-cards',
    '1',
  );
  // A direct card for Paris, from the drawer: it goes through the queue with no network too.
  await page.getByTestId('open-corrections').click();
  const reason = page.getByTestId('direct-card-reason');
  await reason.locator('xpath=ancestor::div[1]').locator('select').selectOption('blue');
  await reason.fill('Struck after the halt');
  await page.locator('[data-testid="direct-card-button"][data-card="yellow"]').click();
  await expect(bar(page)).toHaveAttribute('data-pending', '4');
  expect(stub.cards).toEqual([]);

  await comeBackOnline(page, stub);

  await expect.poll(() => stub.cards.length).toBe(2);
  const [lyon, paris] = stub.cards;
  expect(lyon).toMatchObject({ teamId: 'team-lyon', rulesetEntryId: 'entry-1' });
  expect(paris).toMatchObject({ teamId: 'team-paris', directCard: 'yellow' });
  for (const card of stub.cards) expect(card).not.toHaveProperty('registrationId');
  await expect(bar(page)).toHaveAttribute('data-pending', '0');
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
