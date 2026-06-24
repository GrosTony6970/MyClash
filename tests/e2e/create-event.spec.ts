import { test, expect } from '@playwright/test';
import { runContext } from './_context';

/**
 * Event-creation wizard coverage.
 *
 * NOTE: the create-event API itself is already exercised every run by
 * global-setup. This spec covers the *UI* wizard. Step 1 (basics) is verified
 * here; the full happy path (venue + lices step, review, create, then API
 * hard-delete of the created event) is scaffolded below and finalized during
 * the interactive Playwright-MCP validation pass, which confirms the venue/lice
 * step selectors and the IsoDatePicker fill behaviour.
 */
test('event wizard: step 1 basics renders and accepts input', async ({ page }) => {
  const { orgSlug } = runContext();

  await page.goto(`/org/${orgSlug}/events/new`);

  // Step 1 fields carry stable ids (#wizard-event-name, #wizard-event-slug, …).
  const name = page.locator('#wizard-event-name');
  await expect(name).toBeVisible();
  await name.fill('E2E Wizard Event');
  // Slug auto-derives from the name.
  await expect(page.locator('#wizard-event-slug')).toHaveValue(/e2e-wizard-event/);
});

// eslint-disable-next-line no-empty-pattern
test.fixme('event wizard: full happy path creates and cleans up an event', async ({}) => {
  // TODO(live-validation): fill dates (IsoDatePicker), advance to the venue
  // step, add a lice, complete review, click Create, capture the new eventId
  // from the URL, then DELETE /api/v1/events/:id?mode=hard to clean up.
});
