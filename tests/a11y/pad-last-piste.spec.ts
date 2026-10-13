/**
 * The app opens the last piste at once (quick win P17; operator, 2026-10-12).
 *
 * The tablet of piste 3 is closed at lunch. At 14:00 the app showed the list of
 * pistes again. Now it opens the last piste at once, when it is still one of
 * the pistes of this sign-in, and a tablet with ONE piste opens that piste.
 * The link "Your Lices" still shows the list, and stays on it. Sign-out
 * forgets the piste.
 *
 * The API is stubbed. The tablet holds a PIN session: `/staff-auth/me` answers.
 * The rule has its unit tests (`lib/last-piste.test.ts`).
 */
import { test, expect } from '@playwright/test';
import {
  PAD,
  cards,
  logOut,
  openApp,
  path,
  rememberEvent,
  stubPad,
  title,
} from './pad-pistes-stub';

test('the app opens the last piste at once, and the link still shows the list', async ({
  page,
}) => {
  await stubPad(page, [1, 2, 3]);

  // Nothing is remembered yet: the list.
  await openApp(page);
  await expect(cards(page)).toHaveCount(3);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');

  // Lunch. The app is opened again.
  await openApp(page);
  await expect(title(page)).toHaveText('Piste 3');
  expect(path(page)).toBe('/lices/piste-3');

  // The link shows the list, and the list stays.
  await page.getByRole('link', { name: /your lices/i }).click();
  await expect(cards(page)).toHaveCount(3);
  expect(path(page)).toBe('/lices');
  await cards(page).filter({ hasText: 'Piste 1' }).click();
  await expect(title(page)).toHaveText('Piste 1');

  // The browser's Back shows the list too: it does not leave again.
  await page.goBack();
  await expect(cards(page)).toHaveCount(3);
  expect(path(page)).toBe('/lices');
});

test('a piste reached without the list is remembered too', async ({ page }) => {
  await stubPad(page, [1, 2, 3]);
  await openApp(page);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');

  // The Back of a bout, or an organiser's link: piste 1, by its address.
  await page.goto(`${PAD}/lices/piste-1`);
  await expect(title(page)).toHaveText('Piste 1');

  await openApp(page);
  await expect(title(page)).toHaveText('Piste 1');
});

test('a piste that is no longer one of the pistes of the sign-in is not opened', async ({
  page,
}) => {
  const state = await stubPad(page, [1, 2, 3]);
  await openApp(page);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');

  // Another person signs in on this tablet: pistes 1 and 2.
  state.assigned = [1, 2];
  await openApp(page);

  await expect(cards(page)).toHaveCount(2);
  // The address is no longer an arrival.
  await expect.poll(() => path(page)).toBe('/lices');
});

test('a tablet with one piste opens it at once, and its link shows the list of one', async ({
  page,
}) => {
  await stubPad(page, [7]);

  await openApp(page);
  await expect(title(page)).toHaveText('Piste 7');

  await page.getByRole('link', { name: /your lices/i }).click();
  await expect(cards(page)).toHaveCount(1);
  expect(path(page)).toBe('/lices');
});

test('sign-out forgets the piste', async ({ page }) => {
  await stubPad(page, [1, 2, 3]);
  await rememberEvent(page);
  await openApp(page);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');
  await page.getByRole('link', { name: /your lices/i }).click();
  await expect(cards(page)).toHaveCount(3);

  await logOut(page);

  // The next person signs in: the list, not piste 3.
  await page.goto(`${PAD}/lices?arrive=1`);
  await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => path(page)).toBe('/lices');
});
