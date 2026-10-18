/**
 * A bout scores with its own rules (the foundation, commit 4; rulings K and J).
 *
 * Story. Pool 1 starts on +3 buttons. The organiser switches the Tournament to
 * +2 at 10:00. Bout 2 started at 9:55: it keeps the +3 it started under. The
 * pad read its rules from the Tournament, so it showed +2, a 2 was queued, a 2
 * was stored. Now each bout read carries the bout's own rules, kept with the
 * bout on the tablet; the Tournament gives the display around them.
 *
 * The unit tests hold the composition and the keys (`bout-rules.test.ts`,
 * `penalty-catalogue.test.ts`, `keep-piste.test.ts`). Only a live page proves
 * what the referee presses. The API is stubbed (`pad-piste-stub.ts`): the
 * Tournament's `/match-config` says +2 / +1 at a cap of 5.
 */
import { test, expect, type Page } from '@playwright/test';
import { keptRow, openFirstBout } from './pad-piste-stub';
import { boutRules } from './pad-rounds-score';

const press = (value: number) => ({ label: `+${value}`, value, visible: true });
/** The bout's own copy: +3 / +1, the card rules it pins. */
const ownRules = (cardRulesetId: string | null = null) => ({
  ...boutRules(false, 5),
  buttons: { clean: [press(3), press(1)], afterblow: [] },
  cardRulesetId,
});

const firstButton = (page: Page) =>
  page
    .locator('[data-testid="scoring-column"][data-side="red"]')
    .getByTestId('clean-hit-button')
    .first();
const notice = (page: Page) => page.getByText(/Scoring rules loaded from this tablet/);
const fromTablet = (page: Page) => page.getByTestId('bout-from-tablet');
const nextTile = (page: Page, name: RegExp) => page.getByRole('link', { name });

test('a bout scores with its own buttons, not its Tournament’s, online and from the tablet', async ({
  page,
}) => {
  const stub = await openFirstBout(page, { boutRules: () => ownRules() });

  await expect(firstButton(page)).toHaveText(/\+3/);
  // The bout's own rules and the Tournament's display, both from the server: nothing to say,
  // once the display has been read (no notice is shown while it is asked).
  await expect
    .poll(() => keptRow(page, '/api/v1/tournaments/tournament-1/match-config'))
    .not.toBeNull();
  await expect(notice(page)).toHaveCount(0);

  await expect.poll(() => keptRow(page, 'bout/match-2')).toMatchObject({ rules: ownRules() });
  stub.network = 'down';
  await nextTile(page, /Cy After/).click();

  await expect(page).toHaveURL(/\/matches\/match-2$/);
  await expect(fromTablet(page)).toBeVisible();
  await expect(firstButton(page)).toHaveText(/\+3/);
});

// Ruling J: a bout read without its own rules takes its Tournament's, as last
// read, and says they are not the bout's own.
test('a bout read without its own rules takes its Tournament’s, and says so', async ({ page }) => {
  await openFirstBout(page, { boutRules: null });

  await expect(firstButton(page)).toHaveText(/\+2/);
  await expect(notice(page)).toBeVisible();
});

test('a bout whose Tournament’s config is not held scores with its own rules, and says so', async ({
  page,
}) => {
  await openFirstBout(page, { rules: false, boutRules: () => ownRules() });

  await expect(firstButton(page)).toHaveText(/\+3/);
  await expect(notice(page)).toBeVisible();
});

const entry = (id: string, ref: number, name: string) => ({
  id,
  group_number: ref,
  ref_number: ref,
  short_name: name,
  description: `${name}, in full`,
  sanctions: ['yellow'],
});
const CARDS_A = {
  id: 'cards-a',
  name: 'House rules',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [entry('entry-a', 1, 'Late on guard')],
};
const CARDS_B = {
  id: 'cards-b',
  name: 'Club rules',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [entry('entry-b', 1, 'Leaving the piste')],
};
const entryButton = (page: Page, id: string) =>
  page.locator(`[data-side="red"] [data-testid="penalty-entry-button"][data-entry-id="${id}"]`);

// Two copies of ONE Tournament pin two card rulesets: bout 2 started before the
// organiser changed the card rules. With no network each bout shows its own.
test('with no network each bout shows the catalogue of its own card rules', async ({ page }) => {
  const stub = await openFirstBout(page, {
    boutRules: (id) => ownRules(id === 'match-2' ? 'cards-b' : 'cards-a'),
    catalogues: { 'match-1': CARDS_A, 'match-2': CARDS_B, 'match-3': CARDS_A },
  });
  await expect(entryButton(page, 'entry-a')).toBeVisible();
  await expect.poll(() => keptRow(page, 'penalty-ruleset/card/cards-b')).toEqual(CARDS_B);

  stub.network = 'down';
  await nextTile(page, /Cy After/).click();
  await expect(fromTablet(page)).toBeVisible();
  await expect(entryButton(page, 'entry-b')).toBeVisible();
  await expect(entryButton(page, 'entry-a')).toHaveCount(0);

  await nextTile(page, /Eli Third/).click();
  await expect(page).toHaveURL(/\/matches\/match-3$/);
  await expect(entryButton(page, 'entry-a')).toBeVisible();
  await expect(entryButton(page, 'entry-b')).toHaveCount(0);
});
