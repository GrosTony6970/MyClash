/**
 * The Next and Previous tiles of a bout stay when the network goes. The pad
 * reads the bout's neighbours again after every scored hit, and a read that
 * failed removed the tiles: the first hit scored with no wifi took the way to
 * the next bout off the screen. A failed read now keeps the neighbours last
 * read. Only a live page proves the tile is still there; the unit tests hold
 * whose neighbours are shown (`useAdjacentMatches.test.ts`).
 *
 * The API is stubbed. A dead network is the answer the pad's service worker
 * gives: a 503 with `{ error: 'offline' }`.
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
const NEIGHBOURS = {
  previous: { id: 'match-0', redFighterName: 'Pia Before', blueFighterName: 'Quin Before' },
  next: { id: 'match-2', redFighterName: 'Cy After', blueFighterName: 'Di After' },
};

/** Opens a running bout. Returns the network's switch and the count of neighbour reads. */
async function openBout(page: Page) {
  const state = { offline: false, neighbourReads: 0, neighbours: NEIGHBOURS };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/neighbors')) state.neighbourReads += 1;
    if (state.offline) {
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    if (route.request().method() !== 'GET') return route.fulfill({ status: 201, json: {} });
    if (path.endsWith('/neighbors')) return route.fulfill({ json: state.neighbours });
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
  await expect(page.getByText('Cy After')).toBeVisible();
  return state;
}

/** A hit is scored: the pad reads the neighbours again when its send has ended. */
async function scoreAHit(page: Page, state: { neighbourReads: number }) {
  const before = state.neighbourReads;
  const answered = page.waitForResponse((res) => res.url().endsWith('/neighbors'));
  await page.getByTestId('double-button').click();
  // The answer has landed and the page has drawn it: a tile it removes is gone by now.
  await (await answered).finished();
  await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(() => setTimeout(drawn))));
  expect(state.neighbourReads).toBeGreaterThan(before);
}

test('a hit scored with no network leaves the Next and Previous tiles', async ({ page }) => {
  const state = await openBout(page);
  await expect(page.getByText('Pia Before')).toBeVisible();

  state.offline = true;
  await scoreAHit(page, state);

  await expect(page.getByText('Cy After')).toBeVisible();
  await expect(page.getByText('Pia Before')).toBeVisible();
  await expect(page.getByRole('link', { name: /Cy After/ })).toHaveAttribute(
    'href',
    '/matches/match-2',
  );
});

test('a read that answers still changes the tiles', async ({ page }) => {
  const state = await openBout(page);

  // The next bout was moved to another piste: the server names no next bout.
  state.neighbours = { ...NEIGHBOURS, next: null as unknown as typeof NEIGHBOURS.next };
  await scoreAHit(page, state);

  await expect(page.getByText('Cy After')).toHaveCount(0);
  await expect(page.getByText('Pia Before')).toBeVisible();
});
