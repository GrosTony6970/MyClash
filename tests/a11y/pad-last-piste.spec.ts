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
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const piste = (n: number) => ({
  id: `piste-${n}`,
  name: `Piste ${n}`,
  event: { name: 'Spring Open' },
});

/** The pistes of the sign-in. A story may change them: another person signs in. */
async function stubPad(page: Page, assigned: number[]) {
  const state = { assigned };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith('/staff-auth/me')) return route.fulfill({ json: { id: 'staff-1' } });
    if (path.endsWith('/staff/assigned-lices')) {
      return route.fulfill({ json: state.assigned.map(piste) });
    }
    const list = /\/staff\/lices\/(piste-\d)\/matches$/.exec(path);
    if (list) {
      const liceId = list[1] ?? '';
      const liceName = `Piste ${liceId.slice(-1)}`;
      return route.fulfill({ json: { liceId, liceName, matches: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

const cards = (page: Page) => page.getByTestId('piste-card');
const title = (page: Page) => page.getByTestId('lice-title');
const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;
/** The app is opened: its first page, as the installed app starts. */
const openApp = (page: Page) => page.goto(`${PAD}/`);

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
  // The tablet remembers its Event, as after a sign-in: the banner with the
  // sign-out is shown only then.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'myclash.staff.lastEvent.v1',
      JSON.stringify({ id: 'event-1', slug: 'spring-open', name: 'Spring Open' }),
    );
  });
  await openApp(page);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');
  await page.getByRole('link', { name: /your lices/i }).click();
  await expect(cards(page)).toHaveCount(3);

  await page.getByRole('button', { name: /^log out$/i }).click();
  await page.getByRole('button', { name: /^log out\?$/i }).click();
  await page.waitForURL(/\/login/);

  // The next person signs in: the list, not piste 3.
  await page.goto(`${PAD}/lices?arrive=1`);
  await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => path(page)).toBe('/lices');
});
