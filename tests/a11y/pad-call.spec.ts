/**
 * The referee's call to the control room (ruling 952). The organisers' Live
 * board had a red "Needs attention" state and an Acknowledge button, and
 * nothing could raise it: the pad had no way to call. The pad's Call button
 * raises it, with its reason, and says whether it reached anyone.
 *
 * The API is stubbed. The call is never queued: with no network it says so
 * at once, for the referee to call by voice.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { expectNoCriticalAxeViolations } from './helpers';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'running',
  decision_edition: '2026-10',
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
  roundCode: 'LSW-P1-M01',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'pool',
  bestOf: 1,
};
const CLOCK = {
  status: 'halted',
  activeMs: 30_000,
  totalActiveMs: 30_000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

/** How the server answers the call. */
type Answer = (route: Route) => Promise<void>;

/** Opens the bout. Returns the bodies of the calls the pad sent. */
async function openBout(page: Page, answer: Answer) {
  const calls: unknown[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/staff/attention')) {
      calls.push(route.request().postDataJSON());
      return answer(route);
    }
    if (method !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties') || path.endsWith('/protests')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(page.getByTestId('call-button')).toBeVisible();
  return calls;
}

const dialog = (page: Page) => page.getByRole('dialog');

test('a call for a medic reaches the control room, and the pad says so', async ({ page }) => {
  const calls = await openBout(page, (route) => route.fulfill({ json: { ok: true } }));

  await page.getByTestId('call-button').click();
  await expect(dialog(page)).toContainText('Call the control room');
  for (const button of await dialog(page).getByRole('button').all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoCriticalAxeViolations(page);

  await dialog(page).getByRole('button', { name: 'Medic' }).click();

  await expect(page.getByTestId('call-outcome')).toHaveText(
    'Called. The control room sees your call.',
  );
  expect(calls).toEqual([{ reason: 'medic' }]);
});

test('a call that reaches nobody says so at once, and is not kept to send later', async ({
  page,
}) => {
  const calls = await openBout(page, (route) => route.abort('internetdisconnected'));

  await page.getByTestId('call-button').click();
  await dialog(page).getByRole('button', { name: 'Dispute' }).click();

  await expect(page.getByTestId('call-outcome')).toHaveText(
    'Not sent: no network. Call by voice or by phone.',
  );
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(calls).toEqual([{ reason: 'dispute' }]);
});
