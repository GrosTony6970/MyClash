/**
 * "Edit as no exchange", in the corrections drawer, asks first. One tap voided
 * a scored hit and put a "no exchange" in its place: a slip in the drawer took
 * a fighter's points away. The pad now names the hit and asks. Only a live page
 * proves what a tap does; the pins hold the wiring (`ask-first.screens.test.ts`).
 *
 * The API is stubbed, and every call that is not a read is written down. The
 * bout holds one hit: Ana Red, 2 points.
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
  red_score: 2,
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
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
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
const HIT = {
  id: 'hit-1',
  sequence: 1,
  type: 'clean',
  voided: false,
  client_uuid: 'uuid-1',
  occurredAt: '2026-01-01T10:00:03.000Z',
  clockTimeMs: 3000,
  scoringRegistrationId: 'red-1',
  scoringSide: 'red',
  scoreDelta: 2,
  round_number: 1,
};

/** Opens the bout and its corrections drawer. Returns every call that is not a read. */
async function openDrawer(page: Page, redName = SUMMARY.redName) {
  const sent: string[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      // The pad says it is alive on its own: that is no correction.
      if (!path.endsWith('/staff/heartbeat')) {
        const type = (route.request().postDataJSON() as { type?: string } | null)?.type;
        sent.push(`${method} ${path.split('/api/v1')[1]}${type ? ` ${type}` : ''}`);
      }
      return route.fulfill({ json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) return route.fulfill({ json: { ...SUMMARY, redName } });
    if (path.endsWith('/exchanges')) return route.fulfill({ json: [HIT] });
    if (path.endsWith('/penalties')) return route.fulfill({ json: [] });
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await page.getByTestId('open-corrections').click();
  await expect(rewrite(page)).toBeEnabled();
  return sent;
}

const rewrite = (page: Page) => page.getByRole('button', { name: /^edit as no exchange$/i });
const dialog = (page: Page) => page.getByRole('dialog');

test('Edit as no exchange asks first, names the hit, and changes nothing', async ({ page }) => {
  const sent = await openDrawer(page);

  await rewrite(page).click();

  await expect(dialog(page)).toContainText(/replace this entry with "no exchange"\?/i);
  await expect(dialog(page)).toContainText(/Ana Red/);
  await expect(dialog(page)).toContainText(/its points no longer count/i);
  await expect(dialog(page).getByRole('button', { name: /^cancel$/i })).toBeFocused();
  for (const button of await dialog(page).getByRole('button').all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  // The slip, then Cancel: the question closes, and the drawer stays open.
  await dialog(page)
    .getByRole('button', { name: /^cancel$/i })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rewrite(page)).toBeVisible();
  expect(sent).toEqual([]);

  // Nothing was sent: the correction the official means is the first call.
  await rewrite(page).click();
  await page.getByTestId('ask-first-confirm').click();
  await expect.poll(() => sent).toEqual(['PATCH /exchanges/hit-1/edit no_exchange']);
  await expect(dialog(page)).toHaveCount(0);
});

test('the two controls of the rewrite are the size of a finger', async ({ page }) => {
  // A short name: a long one wraps the button onto two lines, which is tall enough by itself.
  await openDrawer(page, 'Al');

  // The button states its height, and the picker beside it takes the row's.
  expect((await rewrite(page).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const picker = page.getByRole('combobox', { name: /select an exchange/i });
  expect((await picker.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});
