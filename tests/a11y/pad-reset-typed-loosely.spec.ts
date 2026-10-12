/**
 * The words typed before a bout is reset (quick win P9; operator, 2026-10-12).
 *
 * A bout is reset once the official has typed RESET MATCH. The pad took the
 * exact capitals only, and said nothing when the button stayed dead: "reset
 * match" from a tablet's keyboard, or a space after it, did nothing. It also
 * kept the words typed, so the button was armed at the next opening of the
 * drawer.
 *
 * The API is stubbed (`pad-clock-stub.ts`); this spec answers the reset itself.
 * The reading of the words has its unit tests (`lib/reset-phrase.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout } from './pad-clock-stub';

const field = (page: Page) => page.getByTestId('reset-phrase');
const button = (page: Page) => page.getByTestId('reset-match');
const why = (page: Page) => page.getByTestId('reset-phrase-missing');

test('the reset words are read loosely, sent exactly, and gone at the next opening', async ({
  page,
}) => {
  await openBout(page);
  const sent: unknown[] = [];
  await page.route('**/matches/match-1/reset', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });

  await page.getByTestId('open-corrections').click();
  await expect(button(page)).toBeDisabled();
  await expect(why(page)).toContainText('RESET MATCH');

  await field(page).fill('reset');
  await expect(button(page)).toBeDisabled();
  await expect(why(page)).toBeVisible();

  // Small letters and a space after: a tablet's keyboard, a French official.
  await field(page).fill(' reset match ');
  await expect(why(page)).toHaveCount(0);
  await expect(button(page)).toBeEnabled();
  expect((await button(page).boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await button(page).click();
  await expect.poll(() => sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ confirmation: 'RESET MATCH' });

  // The drawer is opened again, later: nothing is typed, and the button is not armed.
  await page.keyboard.press('Escape');
  await page.getByTestId('open-corrections').click();
  await expect(field(page)).toHaveValue('');
  await expect(button(page)).toBeDisabled();
});
