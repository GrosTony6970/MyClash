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

// The panel spaces its direct children. A form around the fields is one child:
// with no spacing of its own, the fields and the button touch each other.
test('the form keeps the gaps between its fields and its button', async ({ page }) => {
  await openLogin(page);

  const box = async (of: ReturnType<typeof email>) => (await of.boundingBox())!;
  const emailBox = await box(email(page));
  const passwordBox = await box(password(page));
  const button = await box(page.getByRole('button', { name: 'Sign in', exact: true }));
  const forgot = await box(page.getByRole('button', { name: /forgot/i }));

  // Between two fields sits the second field's label, and the panel's gap of 16px.
  const label = await box(page.getByText('Password', { exact: true }));
  expect(label.y - (emailBox.y + emailBox.height)).toBeGreaterThanOrEqual(12);
  expect(button.y - (passwordBox.y + passwordBox.height)).toBeGreaterThanOrEqual(12);
  expect(forgot.y - (button.y + button.height)).toBeGreaterThanOrEqual(12);
});

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

// Ruling "Pre-takeover": a sign-up stores no password, the mailed link's page asks for it.
test('the sign-up tab asks for the address only, and sends no password', async ({ page }) => {
  const sent = await openLogin(page);
  await page.getByRole('tab', { name: 'Sign up' }).click();

  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Confirm password')).toHaveCount(0);
  await email(page).fill('lea@example.test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(
    page.getByText('Check your inbox at lea@example.test', { exact: false }),
  ).toBeVisible();
  expect(sent.map((call) => call.path)).toEqual(['/api/v1/auth/public-signup']);
  expect(sent[0]!.body).toMatchObject({ email: 'lea@example.test', next: '/me' });
  expect(sent[0]!.body).not.toHaveProperty('password');
});

test('?tab=reset opens on the reset form', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${LOGIN}?tab=reset`);

  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});
