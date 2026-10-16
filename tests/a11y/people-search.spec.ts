/**
 * An Event's People search: who is who, and a search that fails says so.
 *
 * Its role badges could never show: the server sent no roles (operator ruling 2026-10-16: send
 * them). A search the server failed read "No participants found", as if nobody of that name
 * were there; and an Event that could not be read gave the same answer to every search.
 *
 * The page reads in the browser: each story answers the Event and the lookup.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

const EVENT = { id: 'ev-1', slug: 'test-event', name: 'Open de Lyon', status: 'published' };
const person = (id: string, given: string, family: string, roles: string[]) => ({
  id,
  given_name: given,
  family_name: family,
  club_label: 'Salle Nord',
  masked_email: 'x***@e***.com',
  claimed_by_user_id: null,
  global_person_id: null,
  roles,
});
const MARTINS = [
  person('p-1', 'Léa', 'Martin', ['competitor', 'referee']),
  person('p-2', 'Paul', 'Martin', ['instructor']),
  person('p-3', 'Hugo', 'Martin', []),
];

async function openPeople(page: Page, answers: { event?: number; lookup: number[] }) {
  const lookups = { count: 0 };
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event', (route) =>
    answers.event
      ? route.fulfill({ status: answers.event, json: { detail: 'down' } })
      : route.fulfill({ json: EVENT }),
  );
  await page.route('**/api/v1/events/ev-1/persons/lookup*', (route) => {
    const status = answers.lookup[lookups.count] ?? 200;
    lookups.count += 1;
    return status === 200
      ? route.fulfill({ json: MARTINS })
      : route.fulfill({ status, json: { detail: 'down' } });
  });
  await page.goto(`${PUBLIC}/e/test-event/people`);
  await waitForPageMain(page);
  return lookups;
}

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search by name...' });
const card = (page: Page, name: string) => page.getByRole('link').filter({ hasText: name });

test('each person found shows what they are at the Event', async ({ page }) => {
  await openPeople(page, { lookup: [] });
  await search(page).fill('Martin');

  await expect(card(page, 'Léa Martin').getByText('Competitor', { exact: true })).toBeVisible();
  await expect(card(page, 'Léa Martin').getByText('Referee', { exact: true })).toBeVisible();
  await expect(card(page, 'Paul Martin').getByText('Instructor', { exact: true })).toBeVisible();
  await expect(card(page, 'Hugo Martin')).toBeVisible();
  await expectNoCriticalAxeViolations(page);
});

test('a search the server failed says so, and Try again searches again', async ({ page }) => {
  const lookups = await openPeople(page, { lookup: [500, 500, 500] });
  await search(page).fill('Martin');

  const alert = page.getByRole('alert').filter({ hasText: 'could not search' });
  await expect(alert).toBeVisible();
  await expect(page.getByText(/No participants found/)).toHaveCount(0);

  // The server is well again.
  const before = lookups.count;
  await page.route('**/api/v1/events/ev-1/persons/lookup*', (route) =>
    route.fulfill({ json: MARTINS }),
  );
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page, 'Léa Martin')).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(lookups.count).toBe(before);
});

test('an Event that could not be read says so, not "No participants found"', async ({ page }) => {
  await openPeople(page, { event: 503, lookup: [] });
  await search(page).fill('Martin');

  await expect(page.getByRole('alert').filter({ hasText: 'could not search' })).toBeVisible();
  await expect(page.getByText(/No participants found/)).toHaveCount(0);
});
