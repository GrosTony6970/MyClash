/**
 * A tablet that missed the end of a round catches up when the server refuses
 * its clock. Round 1 of a best-of-3 ended on the table's tablet; this one was
 * opened before, and still shows a live Resume. The server refuses it
 * (`round_awaits_advance`): the pad says what to do in its own words, reads
 * the bout again, and shows the round-break screen that holds the button.
 *
 * The API is stubbed. The unit tests hold the refusal (`clock-round-awaits-
 * advance.test.ts` in the API) and its sentence (`refusal-copy.test.ts`).
 */
import { test, expect } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'paused',
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
  rounds_json: null as unknown,
  awaiting_round_advance: false,
};
const ROUND_ENDED = {
  ...ROW,
  red_round_wins: 1,
  rounds_json: [{ round: 1, winnerColor: 'red' }],
  awaiting_round_advance: true,
};
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'pool',
  bestOf: 3,
};
const HALTED = {
  status: 'halted',
  activeMs: 30_000,
  totalActiveMs: 30_000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};
const API_WORDS = 'Round ended — start the next round before the clock';

test('a clock refused between two rounds says what to do, and shows the round-break screen', async ({
  page,
}) => {
  // What this tablet read when it was opened; the round ended since.
  let row: typeof ROW = ROW;
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method === 'POST' && path.endsWith('/clock')) {
      return route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 400,
          code: 'round_awaits_advance',
          detail: API_WORDS,
          message: API_WORDS,
        }),
      });
    }
    if (method !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: row });
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: HALTED });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  const resume = page.getByTestId('clock-primary-button');
  await expect(resume).toHaveAttribute('data-action', 'resume');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  row = ROUND_ENDED;
  await resume.click();

  const roundBreak = page.getByRole('dialog');
  await expect(roundBreak).toContainText(/round 1 complete/i);
  await expect(roundBreak.getByRole('button', { name: /start round 2/i })).toBeVisible();
  // The pad's own sentence, never the API's.
  await expect(
    page.getByText(/this round is over\. start the next round first\./i).first(),
  ).toBeVisible();
  await expect(page.getByText(API_WORDS)).toHaveCount(0);
});
