import { test, expect, type Page } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
} from './helpers';

/**
 * A refused claim link lands inside the app and says why (ruling 57).
 *
 * The emailed link signs the fighter in, then the API redirects: to the claim
 * page of the row's Event when there is a row, to /me when there is none
 * (ruling 59), with the reason in `?claimRefused=`. These pin that each page
 * turns the reason into its sentence — the mapping has its own unit test; this
 * is the part a deleted `<ClaimRefusedNotice />` would break.
 */

const HELD =
  'You are signed in, but this fighter profile is already linked to another MyClash account. If it is yours, ask the organizer to check your registration.';
const NOT_FOUND =
  'You are signed in, but we could not find the fighter profile in your link. The organizer may have removed it.';

test('claim page - a refused link says the profile is held by another account', async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  await stubPublicApi(page);
  await page.goto(
    'http://localhost:3001/e/test-event/claim?personId=row-1&claimRefused=held_by_another',
  );

  await expect(page.getByText(HELD)).toBeVisible();
  // The form stays: the fighter may still ask for a link to the row's address.
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toBeEnabled();

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('claim page - an ordinary visit shows no refusal', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto('http://localhost:3001/e/test-event/claim?personId=row-1');

  // Enabled means hydrated, which is when the notice would appear.
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toBeEnabled();
  await expect(page.getByText(/^You are signed in, but/)).toHaveCount(0);
});

async function signIn(page: Page): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        type: 'claimed',
        user: { id: 'user-1', email: 'marie@example.test', display_name: 'Marie' },
      },
    }),
  );
  await page.route('**/api/v1/me/events', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/me/personal-space', (route) =>
    route.fulfill({
      json: {
        user: { id: 'user-1', email: 'marie@example.test', display_name: 'Marie' },
        profiles: { globalPerson: null, claimedPersons: [] },
        commitments: { refereeAssignments: [], workshopEnrollments: [] },
        counts: { claimedPersons: 0, events: 0, refereeAssignments: 0, workshopEnrollments: 0 },
        claimable: [],
      },
    }),
  );
}

test('/me - a link whose row is gone says so', async ({ page }) => {
  const issues = collectPageIssues(page);
  await signIn(page);
  await page.goto('http://localhost:3001/me?claimRefused=not_found');

  await expect(page.getByText(NOT_FOUND)).toBeVisible();

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});
