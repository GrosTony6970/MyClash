import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
} from './helpers';

/**
 * A mailed link that signed nobody in lands on a sign-in page that says why (operator
 * rulings 360, 362).
 *
 * The API's door redirects with the reason in `?refused=`. The participant page is a client
 * page that reads its own `searchParams`: these pin that the sentence is on the page a browser
 * draws, and that the form under it still works. The mapping has its own unit test.
 */
const EXPIRED = 'This link has expired or was already used. Ask for a new one.';
const UNCHECKED = 'We could not check this link. Open it again in a moment.';

test('participant sign-in page - a dead link says so, and the form stays', async ({ page }) => {
  const issues = collectPageIssues(page);
  await stubPublicApi(page);
  await page.goto('http://localhost:3001/login?refused=link_expired');

  await expect(page.getByText(EXPIRED)).toBeVisible();
  // A tab that answers a click means the page is live: the sentence survived the hydration.
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByRole('tab', { name: 'Sign up', selected: true }).waitFor();

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('participant sign-in page - a link nobody judged says to open it again', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto('http://localhost:3001/login?refused=link_unchecked');

  await expect(page.getByText(UNCHECKED)).toBeVisible();
  await expect(page.getByText(EXPIRED)).toHaveCount(0);
});

test('participant sign-in page - no reason, or the reason of another door, says nothing', async ({
  page,
}) => {
  await stubPublicApi(page);
  await page.goto('http://localhost:3001/login?refused=admin_lockdown');

  await page.getByRole('tab', { name: 'Sign up' }).waitFor();
  await expect(page.getByText(EXPIRED)).toHaveCount(0);
  await expect(page.getByText(UNCHECKED)).toHaveCount(0);
});
