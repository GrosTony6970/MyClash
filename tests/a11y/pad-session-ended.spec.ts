/**
 * A tap the server answers "nobody is signed in" moves the pad to its sign-in
 * screen (ruling 342). The move is a router call the bout screen makes from a
 * listener, so only a live page proves it: the unit tests hold the decision,
 * and pin the screens as text.
 *
 * The API is stubbed. `/me` answers `anonymous`: the client asks it once to
 * renew a login before a 401 stands, and here no login comes back.
 *
 * A Start goes through the tablet's queue since 2026-10-10, and its 401 still
 * moves the pad. A Re-open is sent at once, as every clock press was before.
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
const ENDED = { ...CLOCK, status: 'ended', activeMs: 30_000 };

/** The bout screen's reads answer; a press of the clock is answered 401 with `code`. */
async function openBout(page: Page, code: string, detail: string, clock = CLOCK) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock') && method === 'GET') return route.fulfill({ json: clock });
    if (path.endsWith('/clock')) {
      return route.fulfill({
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 401, code, detail, message: detail }),
      });
    }
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  const button = page.getByTestId('clock-primary-button');
  // Only a live page draws the clock's button: the listener is set by then.
  await button.waitFor();
  return button;
}

test('a tap answered "nobody is signed in" leaves the bout for the sign-in screen', async ({
  page,
}) => {
  const start = await openBout(page, 'UNAUTHORIZED', 'Staff session required');

  await start.click();

  await expect(page).toHaveURL(`${PAD}/login`);
});

test('an organiser door’s 401 keeps a signed-in scorekeeper on the bout', async ({ page }) => {
  const reopen = await openBout(
    page,
    'organizer_session_required',
    'Organizer session required',
    ENDED,
  );
  await expect(reopen).toHaveAttribute('data-action', 'reopen');
  // An ended clock opens the result over the bout: closed, the button is in reach.
  await page
    .getByTestId('match-result-overlay')
    .getByRole('button', { name: /^close$/i })
    .click();

  await reopen.click();

  await expect(page.getByText(/only an organiser can do this/i).first()).toBeVisible();
  await expect(page.getByText('Organizer session required')).toHaveCount(0);
  expect(page.url()).toBe(`${PAD}/matches/${BOUT}`);
});
