import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
} from './helpers';

test('admin event wizard - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));

  await page.goto('http://localhost:3003/org/test-org/events/new');
  await page.waitForSelector('main');

  await expectNoCriticalAxeViolations(page);

  const eventName = page.getByLabel('Event name *');
  await focusUntil(page, eventName);
  await page.keyboard.type('FAL 2027');
  await expect(eventName).toHaveValue('FAL 2027');

  const next = page.getByRole('button', { name: /^Next/i });
  await focusUntil(page, next);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Start date is required')).toBeVisible();

  await expectNoPageIssues(issues);
});
