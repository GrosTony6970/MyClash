/**
 * The app opened with no network opens the piste it last had (operator,
 * 2026-10-13).
 *
 * The tablet of piste 3 is closed at lunch. At 14:00 the wifi is down and the
 * official opens the app. It showed the sign-in screen, and sign-in cannot work
 * with no wifi, though the tablet held piste 3 and all its bouts. The list of
 * pistes does the same. A tablet that was signed out remembers no piste and
 * still shows sign-in.
 *
 * The API is stubbed (`pad-pistes-stub.ts`). The stubbed browser has no service
 * worker: that the piste PAGE opens with no network is the real-worker probe's
 * to prove (`docs/ARCHITECTURE.md` 10.4). The decision has its unit tests
 * (`lib/staff-session-decision.test.ts`, `lib/last-piste.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { keptRow } from './pad-piste-stub';
import {
  PAD,
  cards,
  logOut,
  openApp,
  path,
  rememberEvent,
  stubPad,
  title,
  type PadStub,
} from './pad-pistes-stub';

/** The official works on piste 3, and the tablet has kept its list. */
async function workOnPiste3(page: Page): Promise<PadStub> {
  const stub = await stubPad(page, [1, 2, 3]);
  await openApp(page);
  await cards(page).filter({ hasText: 'Piste 3' }).click();
  await expect(title(page)).toHaveText('Piste 3');
  // The write is behind the screen: the next open must not race it.
  await expect
    .poll(() => keptRow(page, 'lice-matches/piste-3'))
    .toMatchObject({ liceId: 'piste-3' });
  return stub;
}

for (const network of ['down', 'cut'] as const) {
  test(`opened with no network (${network}), the app opens the last piste from the tablet`, async ({
    page,
  }) => {
    const stub = await workOnPiste3(page);

    stub.network = network;
    await openApp(page);

    await expect(title(page)).toHaveText('Piste 3');
    expect(path(page)).toBe('/lices/piste-3');
    await expect(page.getByTestId('lice-from-tablet')).toHaveText(/this tablet read it on/i);
    await expect(page.getByTestId('network-bar')).toBeVisible();
  });
}

test('the list of pistes with no network opens the last piste too', async ({ page }) => {
  const stub = await workOnPiste3(page);

  stub.network = 'down';
  await page.goto(`${PAD}/lices`);

  await expect(title(page)).toHaveText('Piste 3');
  expect(path(page)).toBe('/lices/piste-3');
});

test('a tablet that remembers no piste shows sign-in with no network', async ({ page }) => {
  const stub = await stubPad(page, [1, 2, 3]);
  stub.network = 'down';

  await openApp(page);

  await page.waitForURL(/\/login/);
});

test('after a sign-out, the app opened with no network shows sign-in', async ({ page }) => {
  await rememberEvent(page);
  const stub = await workOnPiste3(page);
  await page.getByRole('link', { name: /your lices/i }).click();
  await expect(cards(page)).toHaveCount(3);
  await logOut(page);

  stub.network = 'down';
  await openApp(page);

  await page.waitForURL(/\/login/);
  await expect(title(page)).toHaveCount(0);
});

// Operator, 2026-10-13. Anna works piste 3 and goes home without "Log out".
// Ben signs in on that tablet. With no wifi the app gave Ben Anna's piste.
test('another person arrived on this tablet: with no network the app shows sign-in', async ({
  page,
}) => {
  const stub = await workOnPiste3(page);

  // Ben has the same three pistes: with wifi he gets the list, not Anna's piste.
  stub.account = 'staff-2';
  await openApp(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(page).toHaveURL(/\/lices$/);

  stub.network = 'down';
  await openApp(page);

  await page.waitForURL(/\/login/);
  await expect(title(page)).toHaveCount(0);
});

test('a desk account signed in with its PIN since: with no network, sign-in too', async ({
  page,
}) => {
  const stub = await workOnPiste3(page);

  // A desk account never opens the list of pistes: its sign-in is where the tablet learns.
  stub.account = 'staff-2';
  stub.role = 'checkin';
  await page.goto(`${PAD}/login?event=spring-open&u=ben`);
  await page.locator('#staffPin').fill('1234');
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  await page.waitForURL(/\/desk/);

  stub.network = 'down';
  await openApp(page);

  await page.waitForURL(/\/login/);
});

test('the same person signs in again: the piste is still theirs with no network', async ({
  page,
}) => {
  const stub = await workOnPiste3(page);

  await page.goto(`${PAD}/login?event=spring-open&u=anna`);
  await page.locator('#staffPin').fill('1234');
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  await expect(title(page)).toHaveText('Piste 3');

  stub.network = 'down';
  await openApp(page);

  await expect(title(page)).toHaveText('Piste 3');
  expect(path(page)).toBe('/lices/piste-3');
});

// Ruling 295a stands: a server that is up and fails is not "no network".
test('a server that answers a fault still says "could not check"', async ({ page }) => {
  await workOnPiste3(page);
  // Registered after the stub: it answers first.
  await page.route('**/api/v1/staff-auth/me', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 500, json: {} }));

  await openApp(page);

  await expect(page.getByText(/could not check/i)).toBeVisible();
  expect(path(page)).toBe('/');
});
