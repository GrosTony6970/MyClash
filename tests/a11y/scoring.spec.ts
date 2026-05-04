import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
} from './helpers';

test('scoring screen - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));

  await page.goto('http://localhost:3002/lices/test-lice');
  await page.waitForSelector('main');

  await expectNoCriticalAxeViolations(page);

  const licesLink = page.getByRole('button', { name: /lices/i });
  await focusUntil(page, licesLink);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/lices$/);

  await expectNoPageIssues(issues);
});
