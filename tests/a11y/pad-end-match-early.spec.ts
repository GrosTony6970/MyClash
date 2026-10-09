/**
 * "End match" pressed before the cap or the time asks first (operator ruling,
 * 2026-10-08). The button sits just under Pause: an official who means Pause
 * and hits it ended the bout, and Re-open needs the network. A normal end, at
 * the cap or at the time, stays one tap. Only a live page proves what a tap
 * does; the unit tests hold the decision (`end-guard.test.ts`).
 *
 * The API is stubbed, and every call that is not a read is written down. The
 * bout has the default format: 90 seconds, first to 10.
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
  blue_score: 1,
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
  phaseType: 'pool',
  bestOf: 1,
};
/** Paused 30 seconds in. */
const CLOCK = {
  status: 'halted',
  activeMs: 30_000,
  totalActiveMs: 30_000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

interface Bout {
  redScore?: number;
  activeMs?: number;
}

/** Opens the bout. Returns every call that is not a read, as `METHOD path-tail action`. */
async function openBout(page: Page, bout: Bout = {}) {
  const sent: string[] = [];
  const clock = { ...CLOCK, activeMs: bout.activeMs ?? CLOCK.activeMs };
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      const action = (route.request().postDataJSON() as { action?: string } | null)?.action;
      if (path.includes(`/matches/${BOUT}/`)) {
        sent.push(`${method} ${path.split(BOUT)[1]}${action ? ` ${action}` : ''}`);
      }
      // The pad's one write here is the End: the clock it gets back is ended.
      if (path.endsWith('/clock')) return route.fulfill({ json: { ...clock, status: 'ended' } });
      return route.fulfill({ json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) {
      return route.fulfill({ json: { ...ROW, red_score: bout.redScore ?? ROW.red_score } });
    }
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
  return sent;
}

const dialog = (page: Page) => page.getByRole('dialog');

test('before the cap and the time, End match asks first and ends nothing', async ({ page }) => {
  const sent = await openBout(page);

  await page.getByTestId('clock-end-button').click();

  await expect(dialog(page)).toContainText(/end the match now\?/i);
  await expect(dialog(page)).toContainText(/neither the point cap nor the time is reached/i);
  await expect(dialog(page).getByRole('button', { name: /^close$/i })).toBeFocused();
  for (const button of await dialog(page).getByRole('button').all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  // The slip, then a Space: the question closes and nothing was ended.
  await page.keyboard.press('Space');
  await expect(dialog(page)).toHaveCount(0);

  // Nothing was sent: the End the official means is the first call.
  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();
  await expect.poll(() => sent).toEqual(['POST /clock end']);
  await expect(dialog(page).getByText(/end the match now\?/i)).toHaveCount(0);
});

test('once the time is reached, End match ends the bout in one tap', async ({ page }) => {
  const sent = await openBout(page, { activeMs: 90_000 });

  await page.getByTestId('clock-end-button').click();

  await expect.poll(() => sent).toEqual(['POST /clock end']);
  await expect(page.getByText(/end the match now\?/i)).toHaveCount(0);
});

test('once a fighter is at the cap, End match ends the bout in one tap', async ({ page }) => {
  const sent = await openBout(page, { redScore: 10 });

  await page.getByTestId('clock-end-button').click();

  await expect.poll(() => sent).toEqual(['POST /clock end']);
  await expect(page.getByText(/end the match now\?/i)).toHaveCount(0);
});
