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

  await page.goto(`/org/${orgSlug}/events/${eventId}/tournaments/new`);

  // Wait for hydration to settle before touching the form. The wizard is a
  // client component behind `useSearchParams`, so Next streams a server copy and
  // the client renders its own; for roughly the first 100 ms BOTH are in the
  // DOM, and `fill()` landing in that window fails with a strict-mode violation
  // ("resolved to 2 elements"). Counting to 1 polls the race out — the settled
  // page has exactly one field, which is also worth asserting on its own.
  const name = page.getByTestId('tournament-name');
  await expect(name).toHaveCount(1);
  await name.fill('E2E Longsword');
  await page.getByTestId('tournament-create').click();

  // Step 1 → step 2 transition confirms the draft was created server-side.
  await expect(page).toHaveURL(/[?&]step=2/);
});
