import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
} from './helpers';

test('onboarding persona page - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));

  await page.goto('http://localhost:3001/e/test-event/onboarding/persona');
  await page.waitForSelector('main');

  await expectNoCriticalAxeViolations(page);

  const competitor = page.getByRole('button', { name: /competitor/i });
  await focusUntil(page, competitor);
  await page.keyboard.press('Space');
  await expect(competitor).toHaveAttribute('aria-pressed', 'true');

  await expectNoPageIssues(issues);
});
