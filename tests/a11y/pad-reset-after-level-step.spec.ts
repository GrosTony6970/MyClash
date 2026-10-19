/**
 * "Reset clock" is gone from the pad once a level step is taken ("Reset + chain", operator,
 * 2026-10-16). Extra time is granted to a level bout, then "Reset clock" is pressed by mistake:
 * regulation time came back, and the chain's next step was sudden death. The server refuses that
 * Reset (`resetAfterLevelStep`); the pad no longer offers it. A Reopen keeps the chain.
 *
 * The API is stubbed: the bout is paused 30 seconds in, with `levelResolutionSteps` as each test
 * says.
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'QF1',
  status: 'paused',
  decision_edition: '2026-10',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 2,
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
  roundCode: 'QF',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'single_elim',
  bestOf: 1,
};

async function openBout(page: Page, levelResolutionSteps: number) {
  const clock = {
    status: 'halted',
    activeMs: 30_000,
    totalActiveMs: 30_000,
    startedAt: '2026-01-01T10:00:00.000Z',
    levelResolutionSteps,
  };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: clock });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(page.getByTestId('clock-end-button')).toBeEnabled();
}

test('a paused clock with no level step taken offers Reset clock', async ({ page }) => {
  await openBout(page, 0);

  await expect(page.getByTestId('clock-reset-button')).toBeVisible();
});

test('once a level step is taken, the pad offers no Reset clock', async ({ page }) => {
  await openBout(page, 1);

  await expect(page.getByTestId('clock-reset-button')).toHaveCount(0);
});
