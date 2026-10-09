/**
 * The piste picker, when the list of assigned pistes does not load. A server
 * that restarts, or a dead network, sent the whole table to the sign-in screen:
 * every failure of that read was taken for "nobody is signed in". Only a 401 or
 * a 403 says that. Any other failure keeps the official on the picker, with a
 * Retry.
 *
 * The API is stubbed. The tablet holds a PIN session: `/staff-auth/me` answers.
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const PISTES = [{ id: 'lice-1', name: 'Piste Seven', event: { name: 'Spring Open' } }];
const LOAD_FAILED = /failed to load assignments/i;

type Answer = 'pistes' | 'offline' | number;

/** Opens the picker with a live PIN session. `answer` is what the list of pistes says. */
async function openPicker(page: Page, answer: Answer) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/staff-auth/me')) return route.fulfill({ json: { id: 'staff-1' } });
    if (!path.endsWith('/staff/assigned-lices')) return route.fulfill({ status: 404, json: {} });
    if (answer === 'pistes') return route.fulfill({ json: PISTES });
    if (answer === 'offline') {
      return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
    }
    return route.fulfill({ status: answer, json: { detail: 'refused' } });
  });
  await page.goto(`${PAD}/lices`);
}

test('the pistes are listed when the read answers', async ({ page }) => {
  await openPicker(page, 'pistes');

  await expect(page.getByRole('heading', { name: 'Piste Seven' })).toBeVisible();
});

for (const [name, answer] of [
  ['a server that fails', 500],
  ['a server that restarts', 502],
  ['a dead network', 'offline'],
] as const) {
  test(`${name} keeps the official on the picker, with a Retry`, async ({ page }) => {
    await openPicker(page, answer);

    await expect(page.locator('main').getByText(LOAD_FAILED)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/lices');
  });
}

for (const status of [401, 403]) {
  test(`a ${status} is nobody signed in: the sign-in screen opens`, async ({ page }) => {
    await openPicker(page, status);

    await page.waitForURL(/\/login/);
    await expect(page.locator('main').getByText(LOAD_FAILED)).toHaveCount(0);
  });
}
