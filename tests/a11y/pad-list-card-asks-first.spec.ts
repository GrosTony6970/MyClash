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
import { test, expect } from '@playwright/test';
import { dialog, openBout, redRow, row } from './pad-penalty-stub';

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
