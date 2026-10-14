import { expect, test, type Page, type Route } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';
import { LEA, PUBLIC, signInAsLea } from './me-stub';

/**
 * Quick win M8 (operator, 2026-10-14): the security page shows a spinner while it reads, and Enter
 * submits its forms, so a keyboard and a password manager work. It used to show a title and
 * nothing else while it read, and every action was a button outside any form.
 */

const STATUS = { hasPassword: true, email: LEA.email };
const STRONG = 'Bind-and-wind-2026!';

interface Sent {
  path: string;
  body: unknown;
}

/** Léa on /me/security; `hold` keeps the status read out until the story answers it. */
async function openSecurity(page: Page, options: { hold?: boolean } = {}) {
  await signInAsLea(page);
  const sent: Sent[] = [];
  let answerStatus: (() => Promise<void>) | null = null;
  await page.route('**/api/v1/me/security-status', (route: Route) => {
    const answer = () => route.fulfill({ json: STATUS });
    if (options.hold) answerStatus = answer;
    else return answer();
    return undefined;
  });
  // No pending email change (the catch-all `{}` would read as one).
  await page.route('**/api/v1/persons/me/email-change', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: null });
    sent.push({ path: 'email-change', body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/v1/me/change-password', (route) => {
    sent.push({ path: 'change-password', body: route.request().postDataJSON() });
    return route.fulfill({ json: { signedIn: true } });
  });
  await page.goto(`${PUBLIC}/me/security`);
  return { sent, answerStatus: () => answerStatus };
}

test('a spinner shows while the page reads how the account signs in', async ({ page }) => {
  const issues = collectPageIssues(page);
  const security = await openSecurity(page, { hold: true });

  await expect.poll(() => security.answerStatus() !== null).toBe(true);
  await expect(page.locator('main').getByRole('status')).toContainText('Loading...');

  await security.answerStatus()!();
  await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
  await expect(page.locator('main').getByRole('status')).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('Enter in the last password field changes the password, once', async ({ page }) => {
  const security = await openSecurity(page);
  await page.getByLabel('Current password', { exact: true }).fill('old-Password-1!');
  await page.getByLabel('New password', { exact: true }).fill(STRONG);
  await page.getByLabel('Confirm password', { exact: true }).fill(STRONG);
  await page.getByLabel('Confirm password', { exact: true }).press('Enter');

  await expect
    .poll(() => security.sent)
    .toEqual([
      {
        path: 'change-password',
        body: { currentPassword: 'old-Password-1!', newPassword: STRONG },
      },
    ]);
  // The page took the answer (it empties the fields): a second send would be in the list by now.
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveValue('');
  expect(security.sent).toHaveLength(1);
});

test('the password form names the account for a password manager', async ({ page }) => {
  await openSecurity(page);
  const username = page.locator('form input[autocomplete="username"]');
  await expect(username).toHaveCount(1);
  await expect(username).toHaveValue(LEA.email);
});

test('Enter in the new email field asks for the change, once', async ({ page }) => {
  const security = await openSecurity(page);
  await page.getByRole('button', { name: 'Change email' }).click();
  const field = page.getByRole('textbox', { name: /new email/i });
  await field.fill('lea.martin@example.test');
  await field.press('Enter');

  await expect
    .poll(() => security.sent)
    .toEqual([{ path: 'email-change', body: { newEmail: 'lea.martin@example.test' } }]);
  // The page took the answer (the field closes): a second send would be in the list by now.
  await expect(field).toHaveCount(0);
  expect(security.sent).toHaveLength(1);
});
