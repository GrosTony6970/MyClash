/**
 * The Event home answers what people came for (quick wins F6, F7).
 *
 * While the Event ran, "Live now" was the last block of the home, under the
 * rosters, the Tournaments, the Workshops and the venues. And the home had no
 * door to "my schedule": a first-time guest reached their bouts in five taps.
 *
 * The home reads on the SERVER: `scripts/e2e-server-api-stub.mjs` answers it.
 * `test-event` runs and has a bout in play; `quiet-event` is published, not
 * yet running, and has a bout to come. The block reads again from the browser
 * when the page is up, so each story answers that read with the same piste.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { boardBout, liveState, PUBLIC } from './public-pages-stub';

async function openHome(page: Page, slug: string, bout: { status: string }) {
  const running = bout.status === 'running';
  await stubPublicApi(page);
  await page.route(`**/api/v1/events/${slug}/live-state`, (route) =>
    route.fulfill({
      json: liveState([
        {
          lice: { id: 'lice-1', name: 'Piste 1' },
          runningMatch: running ? bout : null,
          nextMatch: running ? null : bout,
        },
      ]),
    }),
  );
  await page.goto(`${PUBLIC}/e/${slug}/home`);
  await waitForPageMain(page);
}

/** How far down the page a heading is. */
async function top(page: Page, name: string): Promise<number> {
  const box = await page.getByRole('heading', { name, exact: true }).boundingBox();
  if (!box) throw new Error(`no heading "${name}" on the page`);
  return box.y;
}

test('while the Event runs, "Live now" is under the header, above the lists', async ({ page }) => {
  await openHome(page, 'test-event', boardBout('M01'));

  const live = await top(page, 'Live now');
  expect(live).toBeGreaterThan(await top(page, 'Open de Lyon'));
  expect(live).toBeLessThan(await top(page, 'Participants'));
  expect(live).toBeLessThan(await top(page, 'Tournaments'));
  expect(live).toBeLessThan(await top(page, 'Schedule'));
  // Drawn once: moved, not copied.
  await expect(page.getByRole('heading', { name: 'Live now', exact: true })).toHaveCount(1);
});

test('before the Event runs, the bouts to come stay after the lists', async ({ page }) => {
  await openHome(page, 'quiet-event', boardBout('M01', { status: 'scheduled' }));

  const highlights = await top(page, 'Schedule highlights');
  expect(highlights).toBeGreaterThan(await top(page, 'Tournaments'));
  expect(highlights).toBeGreaterThan(await top(page, 'Schedule'));
});

for (const slug of ['test-event', 'quiet-event']) {
  test(`the home of ${slug} has the door to "my schedule" and to "find my name"`, async ({
    page,
  }) => {
    await openHome(page, slug, boardBout('M01'));

    const card = page.getByRole('region', { name: 'Taking part in this event?' });
    await expect(card.getByRole('link', { name: 'My schedule' })).toHaveAttribute(
      'href',
      `/e/${slug}/my-schedule`,
    );
    await expect(card.getByRole('link', { name: 'Find my name' })).toHaveAttribute(
      'href',
      `/e/${slug}/participants`,
    );
    // Near the top: right under the header, above every list.
    const cardTop = (await card.boundingBox())!.y;
    expect(cardTop).toBeGreaterThan(
      await top(page, slug === 'test-event' ? 'Open de Lyon' : 'Coupe de Dijon'),
    );
    expect(cardTop).toBeLessThan(await top(page, 'Tournaments'));
    // A finger's width, each. The class is asserted too: in a row, a link that lost its own
    // height is stretched to its neighbour's, and the measure alone stays right.
    for (const name of ['My schedule', 'Find my name']) {
      const link = card.getByRole('link', { name });
      await expect(link).toHaveClass(/(^| )min-h-11( |$)/);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoCriticalAxeViolations(page);
  });
}

test('a French visitor reads the card in French', async ({ page, context }) => {
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  await openHome(page, 'test-event', boardBout('M01'));

  const card = page.getByRole('region', { name: 'Vous participez à cet événement ?' });
  await expect(card.getByRole('link', { name: 'Mon planning' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Trouver mon nom' })).toBeVisible();
});
