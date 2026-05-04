import { test, expect } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';

test('event page - axe clean and skip link keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);

  await page.goto('http://localhost:3001/e/test-event');
  await page.waitForSelector('main');

  await expectNoCriticalAxeViolations(page);

  const skipLink = page.getByRole('link', { name: /skip to main content/i });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await expectNoPageIssues(issues);
});
