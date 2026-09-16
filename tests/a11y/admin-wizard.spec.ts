import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  waitForPageMain,
  focusUntil,
} from './helpers';
import { ORG_SLUG, meFixture } from '../drag/schedule-grid.fixture';

test('admin event wizard - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  // The admin shell asks `/api/v1/me` who is signed in. The catch-all above
  // answers `{}`, which carries no `type`, so `resolveAuthDecision` reads it as
  // `unauthenticated` (organizer-auth-decision.ts:28) and the shell runs
  // `window.location.replace('/login')` (OrganizerAdminShell.tsx:179) — mid-Axe,
  // which destroys the page being scanned. `meFixture` is the repo's one
  // hand-built body for a claimed owner of ORG_SLUG. Registered AFTER the
  // catch-all on purpose: Playwright matches routes in reverse registration
  // order, so the last one registered wins.
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: meFixture }));

  await page.goto(`http://localhost:3003/org/${ORG_SLUG}/events/new`);
  await waitForPageMain(page);

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
