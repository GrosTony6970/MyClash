/**
 * A penalty of the list that gives a red or black card asks first. The list
 * scrolls, and a scroll that lands as a tap gave the card at once: a fighter
 * could be disqualified by a slip. The direct-card panel already asked; the
 * list did not. A yellow card stays one tap. Only a live page proves what a tap
 * does; the unit tests hold which card asks (`card-asks-first.test.ts`).
 *
 * The API is stubbed, and every card the pad sends is written down. The penalty
 * list has a yellow entry, a red entry, a black entry, and an entry that is
 * yellow the first time and red the second.
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
const entry = (id: string, ref: number, name: string, sanctions: string[]) => ({
  id,
  group_number: ref,
  ref_number: ref,
  short_name: name,
  description: `${name}, in full`,
  sanctions,
});
const PENALTY_LIST = {
  id: 'list-1',
  name: 'House list',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [
    entry('entry-yellow', 1, 'Late on guard', ['yellow']),
    entry('entry-red', 2, 'Strike after halt', ['red']),
    entry('entry-black', 3, 'Brutality', ['black']),
    entry('entry-second', 4, 'Leaving the piste', ['yellow', 'red']),
  ],
};
/** Bo Blue already left the piste once in this bout: his second time is a red card. */
const PRIORS = {
  accumulationScope: 'match',
  priors: {
    'red-1': [],
    'blue-1': [{ registrationId: 'blue-1', groupNumber: 4, card: 'yellow', source: 'ruleset' }],
  },
};

/** Opens a running bout. Returns the list entry of every card the pad sent. */
async function openBout(page: Page, savesReach = true) {
  const cards: string[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      if (path.endsWith(`/matches/${BOUT}/penalties`)) {
        const body = route.request().postDataJSON() as { rulesetEntryId?: string };
        cards.push(body.rulesetEntryId ?? 'no entry');
      }
      // A dead network, as the pad's service worker answers it: the card stays in the queue.
      if (!savesReach)
        return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
      return route.fulfill({ status: 201, json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/penalty-ruleset')) return route.fulfill({ json: PENALTY_LIST });
    if (path.endsWith('/penalty-scope')) return route.fulfill({ json: PRIORS });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(redRow(page, 'entry-red')).toBeEnabled();
  return cards;
}

/** One row of the penalty list, in one fighter's column. */
const row = (page: Page, side: 'red' | 'blue', entryId: string) =>
  page.locator(
    `[data-side="${side}"] [data-testid="penalty-entry-button"][data-entry-id="${entryId}"]`,
  );
const redRow = (page: Page, entryId: string) => row(page, 'red', entryId);
const dialog = (page: Page) => page.getByRole('dialog');

test('a red card of the list asks first, names the fighter, and gives nothing', async ({
  page,
}) => {
  const cards = await openBout(page);

  await redRow(page, 'entry-red').click();

  await expect(dialog(page)).toContainText(/issue this card\?/i);
  await expect(dialog(page)).toContainText('Red card for Ana Red: Strike after halt.');
  await expect(dialog(page).getByRole('button', { name: /^cancel$/i })).toBeFocused();
  for (const button of await dialog(page).getByRole('button').all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  // The slip, then a Space: the question closes and no card was given.
  await page.keyboard.press('Space');
  await expect(dialog(page)).toHaveCount(0);

  // The queue sends in order: a card the slip had given would come before this
  // yellow one, so the list proves that nothing was given.
  await redRow(page, 'entry-yellow').click();
  await expect.poll(() => cards).toEqual(['entry-yellow']);

  // The card the referee means is given on the yes.
  await redRow(page, 'entry-red').click();
  await page.getByTestId('ask-first-confirm').click();
  await expect.poll(() => cards).toEqual(['entry-yellow', 'entry-red']);
  await expect(dialog(page)).toHaveCount(0);
});

test('a black card of the list asks first', async ({ page }) => {
  const cards = await openBout(page);

  await redRow(page, 'entry-black').click();

  await expect(dialog(page)).toContainText('Black card for Ana Red: Brutality.');
  await page.getByTestId('ask-first-confirm').click();
  await expect.poll(() => cards).toEqual(['entry-black']);
});

test('the card the fighter will get decides: the same row asks for a second offence only', async ({
  page,
}) => {
  const cards = await openBout(page);

  // Ana Red's first time is a yellow card: one tap.
  await redRow(page, 'entry-second').click();
  await expect.poll(() => cards).toEqual(['entry-second']);
  await expect(dialog(page)).toHaveCount(0);

  // Bo Blue's second time is a red card: the pad asks.
  await row(page, 'blue', 'entry-second').click();
  await expect(dialog(page)).toContainText('Red card for Bo Blue: Leaving the piste.');
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(cards).toEqual(['entry-second']);
});

test('a card the tablet still holds counts: with no network, the second offence asks', async ({
  page,
}) => {
  await openBout(page, false);

  // Ana Red's first time is a yellow card. It cannot be sent: the tablet keeps it.
  await redRow(page, 'entry-second').click();
  await expect(page.locator('[data-side="red"] [data-testid="provisional-score"]')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  // The server will count that card when it arrives: her second time is a red card.
  await redRow(page, 'entry-second').click();
  await expect(dialog(page)).toContainText('Red card for Ana Red: Leaving the piste.');
});

test('a yellow card of the list is given in one tap', async ({ page }) => {
  const cards = await openBout(page);

  await redRow(page, 'entry-yellow').click();

  await expect.poll(() => cards).toEqual(['entry-yellow']);
  await expect(dialog(page)).toHaveCount(0);
});
