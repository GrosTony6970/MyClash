import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
} from './helpers';

test('scoring screen - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  // A deliberately empty payload: the screen must render an empty piste rather
  // than throw. It used to read `data.queue.length` straight off the response,
  // so any 200 that wasn't the exact expected shape white-screened the tablet.
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));

  await page.goto('http://localhost:3002/lices/test-lice');
  await page.waitForSelector('main');

  await expectNoCriticalAxeViolations(page);

  // The back control is a <Link>, so its role is `link` — not `button`.
  const licesLink = page.getByRole('link', { name: /lices/i });
  await focusUntil(page, licesLink);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/lices$/);

  await expectNoPageIssues(issues);
});
