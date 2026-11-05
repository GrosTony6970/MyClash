import { expect, test, type Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { boardBout, liveState, PUBLIC } from './public-pages-stub';
import {
  answerWith,
  openPhotos,
  pageOf,
  photo,
  range,
  tiles,
  TOURNAMENT,
} from './photos-public-stub';

/**
 * An Event's public photos (design, "The public"; slice 4b, rulings 446, 450, 451): the home card,
 * the list, its filter, Load more and the 30 s read. The Event, its Tournament and the home's lists
 * come from `scripts/e2e-server-api-stub.mjs` (`photo-event`, mode Approve first;
 * `photo-off-event`, Off); the photo list and the pictures are answered per test
 * (`photos-public-stub.ts`). The Report is `photos-public-report.spec.ts`.
 */

test.use({ viewport: { width: 390, height: 844 } });

test.describe('the home card', () => {
  async function openHome(page: Page, slug: string) {
    await stubPublicApi(page);
    await page.route(`**/api/v1/events/${slug}/live-state`, (route) =>
      route.fulfill({
        json: liveState([
          {
            lice: { id: 'lice-1', name: 'Piste 1' },
            runningMatch: boardBout('M01'),
            nextMatch: null,
          },
        ]),
      }),
    );
    await page.goto(`${PUBLIC}/e/${slug}/home`);
    await waitForPageMain(page);
  }

  test('a photo Event has the card, under the header and above the lists', async ({ page }) => {
    await openHome(page, 'photo-event');

    await expect(page.getByRole('link', { name: 'See the photos' })).toHaveAttribute(
      'href',
      '/e/photo-event/photos',
    );
    const top = async (name: string) =>
      (await page.getByRole('heading', { name, exact: true }).boundingBox())!.y;
    const card = await top('Photos');
    expect(card).toBeGreaterThan(await top('Live now'));
    expect(card).toBeLessThan(await top('Participants'));
    expect(card).toBeLessThan(await top('Tournaments'));
  });

  test('an Event with photos Off has no card, and no photos page', async ({ page }) => {
    await openHome(page, 'photo-off-event');
    await expect(page.getByRole('link', { name: 'See the photos' })).toHaveCount(0);

    await page.goto(`${PUBLIC}/e/photo-off-event/photos`);
    await expect(page.getByRole('heading', { name: 'Photos', exact: true })).toHaveCount(0);
    await expect(page.getByText('Check the link or the QR code.')).toBeVisible();
  });
});

test('photos show newest first, with name, caption, tag and the Event-clock time', async ({
  page,
}) => {
  await openPhotos(
    page,
    answerWith(
      pageOf([
        photo(0, {
          uploaderName: 'Léa',
          caption: 'Final',
          tag: { kind: 'tournament', name: 'Longsword Open' },
        }),
        photo(5, { caption: 'Warm-up' }),
      ]),
    ),
  );

  await expect(tiles(page)).toHaveCount(2);
  const first = tiles(page).first();
  await expect(first).toContainText('Léa');
  await expect(first).toContainText('Final');
  await expect(first).toContainText('Longsword Open');
  await expect(first).toContainText('Sat 11:00');
  await expect(tiles(page).nth(1)).toContainText('Warm-up');
  await expect(tiles(page).nth(1)).toContainText('10:55');
  await expect(first.getByRole('link')).toHaveAttribute(
    'href',
    'https://bucket.test/p0/original.jpg',
  );
  // No way to send from here (design Goal 1).
  await expect(page.getByRole('button', { name: /send/i })).toHaveCount(0);
});

test('Load more adds the next page from the last photo, and goes when there are no more', async ({
  page,
}) => {
  const reads = await openPhotos(page, (route, request) => {
    const before = new URL(request.url()).searchParams.get('before');
    return route.fulfill({ json: pageOf(before ? range(30, 31) : range(0, 29)) });
  });
  await expect(tiles(page)).toHaveCount(30);

  await page.getByRole('button', { name: 'Load more' }).click();

  await expect(tiles(page)).toHaveCount(32);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(reads.at(-1)!.searchParams.get('before')).toBe(photo(29).createdAt);
});

test('the filter asks for one Tournament, and starts again from the newest', async ({ page }) => {
  const reads = await openPhotos(page, answerWith(pageOf(range(0, 3))));
  await expect(tiles(page)).toHaveCount(4);

  await page.getByLabel('Show').selectOption({ label: 'Longsword Open' });

  await expect.poll(() => reads.at(-1)!.searchParams.get('tournamentId')).toBe(TOURNAMENT);
  expect(reads.at(-1)!.searchParams.get('before')).toBeNull();
});

test('a Load more out when the filter changes is dropped, and Load more works on the new filter', async ({
  page,
}) => {
  let release: (() => void) | null = null;
  await openPhotos(page, async (route, request) => {
    const query = new URL(request.url()).searchParams;
    if (query.get('tournamentId')) {
      // The last 30 photos are all of this Tournament: both lists end on the same photo, so
      // only the filter tells the held page apart (the list's end alone would take it).
      const older = query.get('before');
      const photos = older ? range(70, 71) : range(0, 29, { caption: 'Longsword' });
      return route.fulfill({ json: pageOf(photos) });
    }
    if (query.get('before')) {
      // The old filter's Load more: held until the new filter's page is on screen.
      await new Promise<void>((resolve) => (release = resolve));
      return route.fulfill({ json: pageOf(range(100, 101)) });
    }
    return route.fulfill({ json: pageOf(range(0, 29)) });
  });
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect.poll(() => release !== null).toBe(true);

  await page.getByLabel('Show').selectOption({ label: 'Longsword Open' });
  await expect(page.getByRole('img', { name: 'Longsword' })).toHaveCount(30);
  release!();

  // The held page never shows; the new filter's Load more is open and works.
  await page.waitForTimeout(500);
  await expect(page.locator('img[src*="/p100/"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(tiles(page)).toHaveCount(32);
  await expect(page.locator('img[src*="/p71/"]')).toHaveCount(1);
});

test('a Load more that fails says so, and the button opens again', async ({ page }) => {
  await openPhotos(page, (route, request) =>
    new URL(request.url()).searchParams.get('before')
      ? route.fulfill({ status: 500, json: { statusCode: 500 } })
      : route.fulfill({ json: pageOf(range(0, 29)) }),
  );
  await page.getByRole('button', { name: 'Load more' }).click();

  await expect(page.getByText('Could not load more photos. Try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeEnabled();
  await expect(tiles(page)).toHaveCount(30);
});

test('a Load more with no answer is cut after 20 s, said, and can be asked again', async ({
  page,
}) => {
  await page.clock.install();
  await openPhotos(page, (route, request) =>
    // A dead link: the Load more is never answered.
    new URL(request.url()).searchParams.get('before')
      ? new Promise<void>(() => undefined)
      : route.fulfill({ json: pageOf(range(0, 29)) }),
  );
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeDisabled();

  await page.clock.runFor(20_000);

  await expect(page.getByText('Could not load more photos. Try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeEnabled();
});

test('every 30 s a new photo goes on top, and the loaded ones stay', async ({ page }) => {
  await page.clock.install();
  let newest = range(1, 30);
  await openPhotos(page, (route, request) =>
    new URL(request.url()).searchParams.get('before')
      ? route.fulfill({ json: pageOf(range(31, 32)) })
      : route.fulfill({ json: pageOf(newest) }),
  );
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(tiles(page)).toHaveCount(32);

  newest = range(0, 29);
  await page.clock.runFor(30_000);

  await expect(tiles(page)).toHaveCount(33);
  await expect(tiles(page).first().getByRole('link')).toHaveAttribute(
    'href',
    'https://bucket.test/p0/original.jpg',
  );
});

test('a first read that fails offers Try again, which reads again', async ({ page }) => {
  let fail = true;
  await openPhotos(page, (route) =>
    fail
      ? route.fulfill({ status: 500, json: { statusCode: 500 } })
      : route.fulfill({ json: pageOf(range(0, 1)) }),
  );
  await expect(page.getByText('Could not load the photos.')).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(tiles(page)).toHaveCount(2);
});

test('an Event with no photo yet says so, and that photos are deleted after 30 days', async ({
  page,
}) => {
  await openPhotos(page, answerWith({ photos: [], next: null }));
  await expect(
    page.getByText('No photos to show yet. Every photo is deleted 30 days after the Event.'),
  ).toBeVisible();
});

test('a picture that does not load shows Image unavailable', async ({ page }) => {
  await openPhotos(page, answerWith(pageOf([photo(0, { caption: 'Broken' }), photo(1)])));
  await page.route('https://bucket.test/p0/**', (route) => route.fulfill({ status: 403 }));
  await page.reload();
  await waitForPageMain(page);

  await expect(tiles(page).first()).toContainText('Image unavailable');
  await expect(tiles(page).nth(1).getByRole('img')).toBeVisible();
});
