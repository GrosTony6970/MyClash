import { test, expect } from '@playwright/test';
import { runContext } from './_context';

/**
 * Creates a tournament inside the throwaway test event by walking step 1 of the
 * creation wizard. Submitting step 1 persists a draft tournament (POST
 * /api/v1/events/:eventId/tournaments) and advances to step 2 (url gains
 * ?id=...&step=2). The draft is cleaned up when the event is hard-deleted in
 * global-teardown.
 */
test('create a tournament (wizard step 1 persists a draft)', async ({ page }) => {
  const { orgSlug, eventId } = runContext();

  // `networkidle`, not the default `load`: the wizard is a client component
  // behind `useSearchParams`, so Next streams a server copy and the client
  // renders its own, and for ~120 ms BOTH are in the DOM. Any strict locator
  // call in that window fails with "resolved to 2 elements".
  //
  // Polling for a count of 1 is NOT enough on its own — the count goes 1 (server
  // only) → 2 (both) → 1 (settled), so a poll happily returns on the first 1 and
  // the very next call sees 2. Waiting for the network to go quiet is what puts
  // the page at rest; the count assertion then means something.
  await page.goto(`/org/${orgSlug}/events/${eventId}/tournaments/new`, {
    waitUntil: 'networkidle',
  });

  const name = page.getByTestId('tournament-name');
  await expect(name).toHaveCount(1);
  await name.fill('E2E Longsword');
  await page.getByTestId('tournament-create').click();

  // Step 1 → step 2 transition confirms the draft was created server-side.
  await expect(page).toHaveURL(/[?&]step=2/);
});
