/**
 * The Space bar does not reach the clock behind the round-break screen, nor
 * behind the resume warning. Both were plain `div`s: Space looked for an open
 * dialog, found none, and resumed the clock while nobody fought. Only a live
 * page proves what a key does; the unit tests pin the wiring
 * (`pause-dialogs.screens.test.ts`).
 *
 * The API is stubbed, and every call that is not a read is written down.
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
  rounds_json: null as unknown,
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
const HALTED = {
  status: 'halted',
  activeMs: 30_000,
  totalActiveMs: 30_000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

interface Bout {
  row?: Partial<typeof ROW>;
  bestOf?: number;
  clock?: Partial<typeof HALTED>;
}

/** Opens the bout. Returns every call that is not a read, as `METHOD path-tail`. */
async function openBout(page: Page, bout: Bout = {}) {
  const sent: string[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      const action = (route.request().postDataJSON() as { action?: string } | null)?.action;
      if (path.includes(`/matches/${BOUT}/`)) {
        sent.push(`${method} ${path.split(BOUT)[1]}${action ? ` ${action}` : ''}`);
      }
      if (path.endsWith('/clock')) return route.fulfill({ json: { ...HALTED, status: 'running' } });
      return route.fulfill({ json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: { ...ROW, ...bout.row } });
    if (path.endsWith('/summary')) {
      return route.fulfill({ json: { ...SUMMARY, bestOf: bout.bestOf ?? 1 } });
    }
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: { ...HALTED, ...bout.clock } });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  return sent;
}

const betweenRounds: Bout = {
  bestOf: 3,
  row: {
    awaiting_round_advance: true,
    red_round_wins: 1,
    rounds_json: [{ round: 1, winnerColor: 'red' }],
  },
};
/** The default format: a 90s countdown. At 90s the ruleset says "do not restart". */
const timeIsUp: Bout = { clock: { activeMs: 90_000, totalActiveMs: 90_000 } };

const dialog = (page: Page) => page.getByRole('dialog');
const focusIsInDialog = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);

test('with no screen up, Space resumes the clock, as before', async ({ page }) => {
  const sent = await openBout(page);
  await expect(page.getByTestId('clock-primary-button')).toHaveAttribute('data-action', 'resume');

  await page.keyboard.press('Space');

  await expect.poll(() => sent).toEqual(['POST /clock resume']);
});

test('the round-break screen is a dialog that holds the focus and names the round', async ({
  page,
}) => {
  await openBout(page, betweenRounds);

  await expect(dialog(page)).toContainText(/round 1 complete/i);
  await expect(dialog(page)).toContainText('Ana Red');
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  expect(await focusIsInDialog(page)).toBe(true);
});

test('Space behind the round-break screen does not touch the clock', async ({ page }) => {
  const sent = await openBout(page, betweenRounds);
  await expect(dialog(page)).toBeVisible();

  // A tap beside the screen: the focus leaves its button, as a hand on the table does.
  await page.mouse.click(5, 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');

  // Neither the tap, nor Space, nor Escape took the screen away.
  await expect(dialog(page)).toContainText(/round 1 complete/i);
  // Nor sent anything: the next call the pad makes is the first one.
  await dialog(page)
    .getByRole('button', { name: /start round 2/i })
    .click();
  await expect.poll(() => sent).toEqual(['POST /rounds/advance']);
});

test('Space on the round-break screen’s own button starts the next round, not the clock', async ({
  page,
}) => {
  const sent = await openBout(page, betweenRounds);
  await expect(dialog(page).getByRole('button', { name: /start round 2/i })).toBeFocused();

  await page.keyboard.press('Space');

  await expect.poll(() => sent).toEqual(['POST /rounds/advance']);
});

test('the resume warning opens on Close, and a second Space only closes it', async ({ page }) => {
  const sent = await openBout(page, timeIsUp);
  await expect(page.getByTestId('clock-primary-button')).toHaveAttribute('data-action', 'resume');

  await page.keyboard.press('Space');

  await expect(dialog(page)).toContainText(/time is up/i);
  await expect(dialog(page).getByRole('button', { name: /^close$/i })).toBeFocused();

  await page.keyboard.press('Space');

  await expect(dialog(page)).toHaveCount(0);
  // Nothing restarted: Space meets the warning again, and its restart is the first call.
  await page.keyboard.press('Space');
  await dialog(page)
    .getByRole('button', { name: /continue anyway/i })
    .click();
  await expect.poll(() => sent).toEqual(['POST /clock resume']);
});

test('Space behind the resume warning does not touch the clock', async ({ page }) => {
  const sent = await openBout(page, timeIsUp);
  await page.getByTestId('clock-primary-button').click();
  await expect(dialog(page)).toBeVisible();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');

  await expect(dialog(page)).toBeVisible();
  // Nothing was sent: "End match" is the first call, and it ends, it does not resume.
  await dialog(page)
    .getByRole('button', { name: /end match/i })
    .click();
  await expect.poll(() => sent).toEqual(['POST /clock end']);
});

test('"Continue anyway" still restarts the clock, and its buttons are the size of a finger', async ({
  page,
}) => {
  const sent = await openBout(page, timeIsUp);
  await page.getByTestId('clock-primary-button').click();
  const buttons = dialog(page).getByRole('button');
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await dialog(page)
    .getByRole('button', { name: /continue anyway/i })
    .click();

  await expect.poll(() => sent).toEqual(['POST /clock resume']);
  await expect(dialog(page)).toHaveCount(0);
});
