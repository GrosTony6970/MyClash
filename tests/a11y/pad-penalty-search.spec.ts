/**
 * The search of the penalty list (quick win P15; operator's list of
 * 2026-10-12).
 *
 * The field kept its text after a card: the next penalty started from a list
 * still cut down to the last search. It is emptied once the card is written on
 * the tablet. It keeps its text when the official says no to the red-card
 * question, and when the tablet could not write the card. The field has a name
 * for a screen reader and is a 44px target, and a search that finds nothing
 * says so in its own words.
 *
 * The API is stubbed (`pad-penalty-stub.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { dialog, openBout, redRow } from './pad-penalty-stub';

const red = (page: Page) => page.locator('[data-side="red"]');
const search = (page: Page) => red(page).getByTestId('penalty-search');
const rows = (page: Page) => red(page).getByTestId('penalty-entry-button');

test('the search is emptied by a card, and kept by a "no" to the red-card question', async ({
  page,
}) => {
  const cards = await openBout(page);
  await expect(rows(page)).toHaveCount(4);

  await search(page).fill('strike');
  await expect(rows(page)).toHaveCount(1);

  // No to the question: the official is about to pick again, from the same search.
  await redRow(page, 'entry-red').click();
  await dialog(page)
    .getByRole('button', { name: /^cancel$/i })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(search(page)).toHaveValue('strike');
  await expect(rows(page)).toHaveCount(1);

  await redRow(page, 'entry-red').click();
  await page.getByTestId('ask-first-confirm').click();
  await expect.poll(() => cards).toEqual(['entry-red']);
  await expect(search(page)).toHaveValue('');
  await expect(rows(page)).toHaveCount(4);
});

test('a card the tablet could not write keeps the search', async ({ page }) => {
  const cards = await openBout(page);
  await search(page).fill('late');
  await expect(rows(page)).toHaveCount(1);

  // The tablet's own store refuses the write of this one card.
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
      if (this.name === 'outbox') {
        IDBObjectStore.prototype.add = add;
        throw new Error('the store is full');
      }
      return add.apply(this, args);
    };
  });
  await redRow(page, 'entry-yellow').click();
  await expect(red(page).getByText('the store is full')).toBeVisible();
  await expect(search(page)).toHaveValue('late');

  // The store takes the next one: only that card is sent.
  await redRow(page, 'entry-yellow').click();
  await expect.poll(() => cards).toEqual(['entry-yellow']);
  await expect(search(page)).toHaveValue('');
});

test('the search has a name, is a 44px target, and says when nothing matches', async ({ page }) => {
  await openBout(page);

  await expect(search(page)).toHaveAccessibleName('Search penalties');
  expect((await search(page).boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await search(page).fill('zzz');
  await expect(rows(page)).toHaveCount(0);
  await expect(red(page).getByTestId('penalty-no-match')).toHaveText('No penalty matches "zzz".');
  await expect(red(page).getByText(/no penalty entries configured/i)).toHaveCount(0);
});
