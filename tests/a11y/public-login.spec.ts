/**
 * The participant sign-in page, used from a phone's keyboard (quick win F12).
 *
 * The page had no form: Enter did nothing, a password manager had nothing to
 * submit, and a button pressed over an empty field said nothing at all.
 *
 * The API is stubbed: every call answers `{}` with a 200, which the page reads
 * as "signed in" or "sent". A story records the sign-in calls it cares about.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi } from './helpers';

const LOGIN = 'http://localhost:3001/login';

interface Sent {
  path: string;
  body: Record<string, unknown>;
}

/** Open the page, live, and record every POST to an `auth` route. */
async function openLogin(page: Page, address = LOGIN): Promise<Sent[]> {
  const sent: Sent[] = [];
  await stubPublicApi(page);
  await page.route('**/api/v1/auth/**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      sent.push({
        path: new URL(request.url()).pathname,
        body: request.postDataJSON() as Record<string, unknown>,
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(address);
  // A tab that answers a click means the page is live.
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByRole('tab', { name: 'Sign in', selected: true }).waitFor();
  return sent;
}

const email = (page: Page) => page.getByLabel('Email address');
const password = (page: Page) => page.getByLabel('Password', { exact: true });

test('Enter in the password field signs in, once', async ({ page }) => {
  const sent = await openLogin(page);

  await email(page).fill('lea@example.test');
  await password(page).fill('correct horse');
  await password(page).press('Enter');

  await page.waitForURL('**/me');
  expect(sent).toEqual([
    {
      path: '/api/v1/auth/public-login',
      body: { email: 'lea@example.test', password: 'correct horse' },
    },
  ]);
});

test('Enter over an empty email says so, and sends nothing', async ({ page }) => {
  const sent = await openLogin(page);

  await password(page).fill('correct horse');
  await password(page).press('Enter');
  await expect(page.getByText('Enter your email address.')).toBeVisible();

  // The sentence goes when the field is filled and the form is sent: one call in all.
  await email(page).fill('lea@example.test');
  await email(page).press('Enter');
  await page.waitForURL('**/me');
  expect(sent.map((call) => call.path)).toEqual(['/api/v1/auth/public-login']);
});

test('the Sign in button over an empty password says so, and sends nothing', async ({ page }) => {
  const sent = await openLogin(page);

  await email(page).fill('lea@example.test');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  await expectNoCriticalAxeViolations(page);

  await password(page).fill('correct horse');
  await password(page).press('Enter');
  await page.waitForURL('**/me');
  expect(sent.map((call) => call.path)).toEqual(['/api/v1/auth/public-login']);
});

test('the email-link button over an empty email says so, and sends nothing', async ({ page }) => {
  const sent = await openLogin(page);

  await page.getByRole('button', { name: /link/i }).click();
  await expect(page.getByText('Enter your email address.')).toBeVisible();

  await email(page).fill('lea@example.test');
  await page.getByRole('button', { name: /link/i }).click();
  await expect(page.getByText(/a login link has been sent/)).toBeVisible();
  expect(sent.map((call) => call.path)).toEqual(['/api/v1/auth/magic-link']);
});

test('Enter on the reset form asks for the reset link, once', async ({ page }) => {
  const sent = await openLogin(page);
  await page.getByRole('button', { name: /forgot/i }).click();

  await email(page).press('Enter');
  await expect(page.getByText('Enter your email address.')).toBeVisible();

  await email(page).fill('lea@example.test');
  await email(page).press('Enter');
  await expect(page.getByText('Enter your email address.')).toHaveCount(0);
  expect(sent).toEqual([
    { path: '/api/v1/auth/public-password-reset', body: { email: 'lea@example.test' } },
  ]);
});
