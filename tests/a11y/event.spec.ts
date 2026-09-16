import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
  waitForPageMain,
} from './helpers';

test('event page - axe clean and skip link keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await stubPublicApi(page);

  // `/e/test-event` is a redirect to this page (page.tsx). Landing on the
  // redirect navigated the tab out from under Axe mid-scan, which arrives as
  // "Execution context was destroyed". Ask for the final page.
  await page.goto('http://localhost:3001/e/test-event/home');
  await waitForPageMain(page);

  await expectNoCriticalAxeViolations(page);

  const skipLink = page.getByRole('link', { name: /skip to main content/i });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await expectNoPageIssues(issues);
});
