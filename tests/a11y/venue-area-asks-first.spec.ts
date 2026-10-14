import { test, expect, type Page } from '@playwright/test';
import { ORG_SLUG, meFixture } from '../drag/schedule-grid.fixture';

/**
 * O25 (ruled 2026-10-14): removing a venue area asks first, naming what it holds, and Escape
 * closes only the top dialog. Each dialog heard Escape by itself: one press closed the question
 * AND the venue window behind it. Only a real key press in a real browser shows the order in
 * which the dialogs hear it.
 */
const VENUE = {
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Gymnase',
  address: null,
  hosts_tournament: false,
  hosts_workshop: true,
  sort_order: 0,
  venue_lices: [],
  venue_areas: [
    {
      id: 'a-1',
      name: 'Hall A',
      sort_order: 0,
      leaves: { pistes: [{ name: 'Piste 3', event: 'Open 2027' }], sessions: [] },
    },
  ],
  events: [],
};

async function openVenueWindow(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  // Registered after the catch-all: the last route registered answers first.
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: meFixture }));
  await page.route(`**/api/v1/organizations/slug/${ORG_SLUG}`, (route) =>
    route.fulfill({ json: { id: 'org-1', name: 'Fixture Club' } }),
  );
  await page.route('**/api/v1/organizations/org-1/venues', (route) =>
    route.fulfill({ json: [VENUE] }),
  );
  await page.route('**/api/v1/organizations/org-1/events', (route) => route.fulfill({ json: [] }));
  await page.goto(`http://localhost:3003/org/${ORG_SLUG}/venues`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(venueWindow(page)).toBeVisible();
  return writes;
}

const venueWindow = (page: Page) => page.getByRole('dialog', { name: 'Edit venue' });
const question = (page: Page) => page.getByRole('dialog', { name: 'Remove the area "Hall A"?' });

test('Escape closes the question first, and the venue window only at the next press', async ({
  page,
}) => {
  const writes = await openVenueWindow(page);
  await venueWindow(page)
    .getByRole('listitem')
    .filter({ hasText: 'Hall A' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(question(page)).toContainText('Piste Piste 3 (Open 2027)');

  await page.keyboard.press('Escape');
  await expect(question(page)).toHaveCount(0);
  await expect(venueWindow(page)).toBeVisible();
  await expect(venueWindow(page)).toContainText('Hall A');

  await page.keyboard.press('Escape');
  await expect(venueWindow(page)).toHaveCount(0);
  expect(writes).toEqual([]);
});
