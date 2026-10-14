import { test, expect } from '@playwright/test';
import { EVENT_ID } from './schedule-grid.fixture';
import { openDetailedGrid } from './schedule-grid.harness';

/**
 * O25 (ruled 2026-10-14): Enter adds a piste on the schedule board, as its Add button does.
 * Six pistes were six "type, then reach for the mouse".
 */
test('Enter in the new piste field adds the piste', async ({ page }) => {
  const api = await openDetailedGrid(page);
  await page.getByRole('button', { name: '+ Add lice', exact: true }).click();
  const field = page.getByPlaceholder('Lice 4');
  await field.fill('Lice 9');
  await field.press('Enter');

  await expect
    .poll(() => api.writes.map((w) => `${w.method()} ${new URL(w.url()).pathname}`))
    .toContain(`POST /api/v1/events/${EVENT_ID}/lices`);
  const sent = api.writes.find((w) => new URL(w.url()).pathname.endsWith('/lices'));
  expect(sent?.postDataJSON()).toMatchObject({ name: 'Lice 9' });
});
