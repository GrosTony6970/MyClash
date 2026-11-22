import { test, expect, type Locator, type Page } from '@playwright/test';
import { PUBLIC, signInAsLea } from './me-stub';

/**
 * Léa opens People on her phone. In a search result, "Follow" and "Add to group" stood beside the
 * fighter's name and squeezed it to "Yan…"; in her group's header, Rename and Delete squeezed the
 * group's name to one letter. On a phone the buttons now sit on their own line, under the name.
 */
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

const NAME = 'Yane Li Ah Chong-Dubourgnon';
const GROUP = 'Club de Lyon — compétiteurs';

async function openPeople(page: Page, tab: 'search' | 'groups') {
  await signInAsLea(page);
  await page.route('**/api/v1/me/groups', (route) =>
    route.fulfill({ json: [{ id: 'g1', name: GROUP, members: [] }] }),
  );
  await page.route('**/api/v1/fighters?q=*', (route) =>
    route.fulfill({
      json: [
        {
          id: 'gp-1',
          slug: 'yane',
          display_name: NAME,
          photo_url: null,
          country_code: 'FR',
          clubs: { name: 'Les Lions de la Fosse' },
        },
      ],
    }),
  );
  await page.goto(`${PUBLIC}/me/follows?tab=${tab}`);
}

/** The top of `below` is at or under the bottom of `above`. */
async function expectUnder(below: Locator, above: Locator) {
  const a = (await above.boundingBox())!;
  const b = (await below.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
}

test('a search result shows the whole name, with its buttons under it', async ({ page }) => {
  await openPeople(page, 'search');
  await page.getByRole('searchbox').or(page.getByRole('textbox')).first().fill('Yane');
  // The name's line also carries the flag and, for a screen reader, the country.
  const name = page.locator('article p', { hasText: NAME });
  await expect(name).toBeVisible();

  await expectUnder(page.getByRole('button', { name: 'Add to group' }), name);
  // Nothing cut: the name's text fits the box it is drawn in.
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("a group's header keeps its name readable, with its buttons under it", async ({ page }) => {
  await openPeople(page, 'groups');
  const heading = page.getByRole('heading', { name: GROUP });
  await expect(heading).toBeVisible();

  await expectUnder(page.getByRole('button', { name: 'Rename' }), heading);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expectUnder(page.getByRole('button', { name: 'Cancel' }), heading);
  expect((await heading.boundingBox())!.width).toBeGreaterThan(150);
});
