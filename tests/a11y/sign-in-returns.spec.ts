/**
 * Signing in returns a visitor to the page they came from (quick win F11).
 *
 * A door to the sign-in page sent `?next=`, and the page ignored it: every
 * sign-in landed on the personal space, and the fighter looked for their page
 * again. The address is one anybody can write, so it is kept only when it is a
 * path of our own site.
 *
 * The API is stubbed: every call answers `{}` with a 200.
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi } from './helpers';

const PUBLIC = 'http://localhost:3001';
const LIVE_BOARD = '/e/test-event/live';

/** Open the sign-in page, live, with the `next` a door gave it. Records the email-link calls. */
async function openLogin(page: Page, next: string | null): Promise<Array<Record<string, unknown>>> {
  const mailed: Array<Record<string, unknown>> = [];
  await stubPublicApi(page);
  await page.route('**/api/v1/auth/magic-link', (route) => {
    mailed.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: {} });
  });
  const query = next === null ? '' : `?next=${encodeURIComponent(next)}`;
  await page.goto(`${PUBLIC}/login${query}`);
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByRole('tab', { name: 'Sign in', selected: true }).waitFor();
  return mailed;
}

async function signInByPassword(page: Page) {
  await page.getByLabel('Email address').fill('lea@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByLabel('Password', { exact: true }).press('Enter');
}

test('a password sign-in returns to the page the door was on', async ({ page }) => {
  await openLogin(page, LIVE_BOARD);
  await signInByPassword(page);

  await page.waitForURL(`${PUBLIC}${LIVE_BOARD}`);
});

test('with no page to return to, sign-in lands on the personal space', async ({ page }) => {
  await openLogin(page, null);
  await signInByPassword(page);

  await page.waitForURL(`${PUBLIC}/me`);
});

for (const elsewhere of ['//other-site.test/x', 'https://other-site.test/x', '/login']) {
  test(`an address that is not a page to return to is dropped: ${elsewhere}`, async ({ page }) => {
    await openLogin(page, elsewhere);
    await signInByPassword(page);

    await page.waitForURL(`${PUBLIC}/me`);
  });
}

test('the email link is asked for with the page to return to', async ({ page }) => {
  const mailed = await openLogin(page, LIVE_BOARD);
  await page.getByLabel('Email address').fill('lea@example.test');
  await page.getByRole('button', { name: /link/i }).click();

  await expect(page.getByText(/a login link has been sent/)).toBeVisible();
  expect(mailed).toEqual([
    { email: 'lea@example.test', type: 'public_login', redirectTo: LIVE_BOARD },
  ]);
});

test('the site header sends the page it is on', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/test-event/pass`);

  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login?next=%2Fe%2Ftest-event%2Fpass',
  );
});

// A sign-in page is no page to return to: signing in would show the form again.
test('on the sign-in page itself, the header sends no page', async ({ page }) => {
  await openLogin(page, LIVE_BOARD);

  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login',
  );
});

// The mailed link and Google land a visitor of the home on the personal space
// (the API reads `/` as "no page given"): a password sign-in lands there too.
test("a password sign-in given the site's home lands on the personal space", async ({ page }) => {
  await openLogin(page, '/');
  await signInByPassword(page);

  await page.waitForURL(`${PUBLIC}/me`);
});
