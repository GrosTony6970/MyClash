import { test, expect } from '@playwright/test';
import { runContext } from './_context';

/**
 * Event-creation wizard (full UI). The create-event API is also exercised every
 * run by global-setup; this covers the 4-step wizard end to end and cleans up
 * the event it creates (a separate event from the shared throwaway one).
 * Locale-proof: targets ids/testids and the date-picker's numeric day cells
 * rather than i18n button text.
 */
test('event wizard: step 1 basics renders and accepts input', async ({ page }) => {
  const { orgSlug } = runContext();

  await page.goto(`/org/${orgSlug}/events/new`);

  // Count first, then assert visibility: the wizard streams a server copy and
  // hydrates a client one, so for ~100 ms both are in the DOM and every strict
  // locator call — `toBeVisible()` included — fails with "resolved to 2
  // elements". See the same note in `02`.
  const name = page.locator('#wizard-event-name');
  await expect(name).toHaveCount(1);
  await expect(name).toBeVisible();
  await name.fill('E2E Wizard Event');
  await expect(page.locator('#wizard-event-slug')).toHaveValue(/e2e-wizard-event/);
});

test('event wizard: full happy path creates and cleans up an event', async ({ page, request }) => {
  const { orgSlug } = runContext();

  // Robust against both the current and future deploys: prefer the data-testid
  // added in this change; fall back to the live build's controls (English text
  // / DOM order) until those testids ship.
  const next = page
    .getByTestId('wizard-next')
    .or(page.getByRole('button', { name: 'Next', exact: true }));

  await page.goto(`/org/${orgSlug}/events/new`);

  // Unique token keeps the slug AND the org-scoped venue name (venues persist
  // org-wide, not per event) from colliding across runs.
  const tok = Date.now().toString(36);

  // Step 1 — basics. Dates come from the calendar popover (day cells are
  // locale-independent numbers). Count to 1 first — the hydration race above.
  const eventName = page.locator('#wizard-event-name');
  await expect(eventName).toHaveCount(1);
  await eventName.fill('E2E Full Wizard');
  await page.locator('#wizard-event-slug').fill(`e2e-full-wizard-${tok}`);
  await page.locator('#wizard-start-date').click();
  await page.getByRole('button', { name: '15', exact: true }).click();
  await page.locator('#wizard-end-date').click();
  await page.getByRole('button', { name: '20', exact: true }).click();
  await next.click();

  // Step 2 — venue & lices. New venue + tournament capability; lices are
  // pre-filled (Lice 1/2), which already satisfies step-2 validation.
  await page.getByTestId('venue-mode-new').or(page.getByRole('tab').nth(1)).click();
  await page.locator('#wizard-venue-name').fill(`E2E Venue ${tok}`);
  const hostsTournament = page
    .getByTestId('venue-hosts-tournament')
    .or(page.getByRole('checkbox').first());
  if (!(await hostsTournament.isChecked())) await hostsTournament.check();
  await next.click();

  // Step 3 — theme (no required fields) → Step 4 — review → create.
  await next.click();
  await page
    .getByTestId('wizard-create')
    .or(page.getByRole('button', { name: /create/i }))
    .click();

  // Success redirects to /org/:slug/events/:eventId — capture the new id.
  await page.waitForURL(/\/org\/[^/]+\/events\/[0-9a-f-]{36}(\/|\?|$)/i, { timeout: 20_000 });
  const eventUrl = page.url();
  const eventId = eventUrl.split('/events/')[1].split(/[/?#]/)[0];
  expect(eventId).toMatch(/^[0-9a-f-]{36}$/i);

  // Preserve by default so you can inspect the wizard-created event; delete only
  // when E2E_CLEANUP is set (CI).
  if (['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase())) {
    const del = await request.delete(`/api/v1/events/${eventId}?mode=hard`);
    expect(del.ok()).toBeTruthy();
  } else {
    console.log(`[e2e] wizard event preserved: ${eventUrl}`);
  }
});
