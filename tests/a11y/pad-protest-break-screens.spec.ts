/**
 * A Fighter protests a call between rounds and after the end too: the
 * round-break screen and the result screen each offer both Fighters' protest
 * buttons. A tap records one protest, with no question, and the button counts
 * it once the server holds it. With no network, a protest is an entry of the
 * bout's history like any other: "Undo last entry" can take it back.
 *
 * The API is stubbed (`pad-rounds-stub.ts`: a best-of-3 Pool bout, cap 2; a
 * protest the server takes is listed back). The tap itself has the unit tests
 * (`offline/protest.test.ts`).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  openBestOf,
  plusTwo,
  result,
  roundBreak,
  startAndHalt,
  startNextRound,
} from './pad-rounds-stub';

/** One Fighter's protest button inside a screen, found by its name. */
const protestIn = (screen: Locator, fighter: 'Ana Red' | 'Bo Blue') =>
  screen.getByRole('button', { name: `Record a protest by ${fighter}` });
/** The bout's history in the centre of the pad (a scrolling region, or a list). */
const history = (page: Page) => page.locator('[aria-label="Exchange history"]');
const undoLast = (page: Page) => page.getByTestId('undo-last-entry');

test('on the round-break screen, a protest is one tap, sent once, and counted', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  // The protest buttons come after the screen's own: a Space still starts the round.
  await expect(startNextRound(page)).toBeFocused();
  const red = protestIn(roundBreak(page), 'Ana Red');
  await expect(red).toHaveAttribute('data-count', '0');
  await expect(protestIn(roundBreak(page), 'Bo Blue')).toBeEnabled();

  await red.click();

  await expect(red).toHaveAttribute('data-count', '1');
  // The name a screen reader says carries the count the button shows.
  await expect(red).toHaveAccessibleName('Record a protest by Ana Red (1 so far)');
  await expect(protestIn(roundBreak(page), 'Bo Blue')).toHaveAttribute('data-count', '0');
  expect(stub.sent).toEqual([
    'POST /clock start',
    'POST /clock halt',
    'POST /exchanges',
    'POST /protests',
  ]);
  expect(stub.protests).toMatchObject([{ registration_id: 'red-1', round_number: 1 }]);
  // The round break is still up: a protest does not start the next round.
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
});

test('on the result screen after the last round, a protest is one tap, sent once, and counted', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  await expect(roundBreak(page)).toHaveCount(0);
  await plusTwo(page, 'red').click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('match-result-winner')).toContainText('Ana Red');
  const blue = protestIn(result(page), 'Bo Blue');
  await expect(blue).toHaveAttribute('data-count', '0');

  await blue.click();

  await expect(blue).toHaveAttribute('data-count', '1');
  await expect(protestIn(result(page), 'Ana Red')).toHaveAttribute('data-count', '0');
  expect(stub.sent).toEqual([
    'POST /clock start',
    'POST /clock halt',
    'POST /exchanges',
    'POST /rounds/advance 2',
    'POST /exchanges',
    'POST /protests',
  ]);
  expect(stub.protests).toMatchObject([{ registration_id: 'blue-1' }]);
});

test('with no network, a protest that is the only entry of the bout is in the history, and can be undone', async ({
  page,
}) => {
  const stub = await openBestOf(page, { haltedAtMs: 5000 });
  stub.network = 'down';
  await expect(undoLast(page)).toBeDisabled();

  await protestIn(
    page.locator('[data-testid="scoring-column"][data-side="red"]'),
    'Ana Red',
  ).click();

  // The one line of the history: the protest, waiting on the tablet.
  const line = history(page).locator('li[data-pending="true"]');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('Ana Red');
  await expect(line).toContainText('Protest');
  await expect(history(page).locator('li')).toHaveCount(1);
  await expect(undoLast(page)).toBeEnabled();

  await undoLast(page).click();

  await expect(line).toHaveCount(0);
  await expect(undoLast(page)).toBeDisabled();
  await expect(protestIn(page.locator('[data-side="red"]'), 'Ana Red')).toHaveAttribute(
    'data-count',
    '0',
  );
  expect(stub.sent, 'nothing reached the server').toEqual([]);
});
