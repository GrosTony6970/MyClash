import { test, expect } from '@playwright/test';
import { runContext } from './_context';

/**
 * Schedule / programme planner coverage.
 *
 * The smoke test below confirms the schedule workspace and its programme
 * planner load for the test event. Full schedule generation (suggest programme
 * → save → generate grid → assert "N matches scheduled" toast) needs a
 * tournament with enough registered participants to form pools/matches; that
 * precondition + the generate assertions are finalized during the interactive
 * Playwright-MCP validation pass.
 */
test('schedule page loads with the programme planner', async ({ page }) => {
  const { orgSlug, eventId } = runContext();

  await page.goto(`/org/${orgSlug}/events/${eventId}/schedule`);

  // The planner's "Generate schedule" (suggest) control lives in the grid's
  // right sidebar and is present on load.
  await expect(page.getByTestId('schedule-suggest')).toBeVisible();
});

// eslint-disable-next-line no-empty-pattern
test.fixme('schedule: generate grid places matches', async ({}) => {
  // TODO(live-validation): ensure a tournament with participants exists, click
  // schedule-suggest to lay out programme blocks, Save programme, click
  // schedule-generate, and assert the toast reports matchesScheduled > 0.
});
