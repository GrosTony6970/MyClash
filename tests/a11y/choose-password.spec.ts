/**
 * The page a sign-up's mail opens: "choose your password" (ruling "Pre-takeover", 2026-10-16).
 *
 * Léa opens the mail on her phone. Opening the page must not spend the link: a mail scanner
 * opens links too. The code is spent by ONE request, when she sends a password. A link that
 * was used or is too old says so, and offers "Forgot password?" (a recovery mail works on an
 * account that was never confirmed).
 *
 * The API is stubbed: the door's answer is set per test.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi } from './helpers';

const PAGE = 'http://localhost:3001/auth/choose-password?next=%2Fme&token_hash=c0de-from-the-mail';
const CHOSEN = 'A-much-Longer-passw0rd!';

interface Door {
  status: number;
  body: Record<string, unknown>;
}

/** Open the page with the door answering `door`, and record every call to the door. */
async function open(page: Page, door: Door): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await stubPublicApi(page);
  await page.route('**/api/v1/auth/public-choose-password', (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: door.status, json: door.body });
  });
  await page.goto(PAGE);
  return sent;
}

async function choose(page: Page, password = CHOSEN): Promise<void> {
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Save my password' }).click();
}

test('opening the page sends nothing; one press sends the code, the password and the page', async ({
  page,
}) => {
  const sent = await open(page, {
    status: 200,
    body: { saved: true, signedIn: true, next: '/me' },
  });
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await expectNoCriticalAxeViolations(page);
  expect(sent).toEqual([]);

  await choose(page);

  await page.waitForURL('**/me');
  expect(sent).toEqual([{ token_hash: 'c0de-from-the-mail', password: CHOSEN, next: '/me' }]);
});

test('the button stays off until the two fields agree and meet the rules', async ({ page }) => {
  const sent = await open(page, { status: 200, body: {} });
  const save = page.getByRole('button', { name: 'Save my password' });

  await page.getByLabel('New password').fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await expect(save).toBeDisabled();
  await page.getByLabel('New password').fill(CHOSEN);
  await expect(save).toBeDisabled();
  await page.getByLabel('Confirm password').fill(CHOSEN);
  await expect(save).toBeEnabled();
  expect(sent).toEqual([]);
});

test('a used or old link says so, and offers "Forgot password?"', async ({ page }) => {
  await open(page, { status: 401, body: { code: 'link_expired' } });

  await choose(page);

  await expect(page.getByText('This link was already used or is too old.')).toBeVisible();
  const forgot = page.getByRole('link', { name: 'Forgot password?' });
  await expect(forgot).toHaveAttribute('href', '/login?tab=reset');
  await forgot.click();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});

test('a link nobody judged says to open it again, with no "Forgot password?"', async ({ page }) => {
  await open(page, { status: 200, body: { code: 'link_unchecked' } });

  await choose(page);

  await expect(page.getByText('We could not check this link.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(0);
});

test('a password the server did not save says so, and offers to set one', async ({ page }) => {
  await open(page, { status: 200, body: { saved: false, signedIn: true, next: '/me' } });

  await choose(page);

  await expect(page.getByText('your password was not saved')).toBeVisible();
  await expect(page.getByRole('link', { name: /Set a password/ })).toHaveAttribute(
    'href',
    '/me/security',
  );
  await expectNoCriticalAxeViolations(page);
});

test('a saved password with no login asks her to sign in', async ({ page }) => {
  await open(page, { status: 200, body: { saved: true, signedIn: false, next: '/me' } });

  await choose(page);

  await expect(page.getByText('Password saved. Sign in with your new password.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login',
  );
});
