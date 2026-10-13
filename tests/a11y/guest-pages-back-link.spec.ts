/**
 * Every guest page that is not the Event's home has a link back to it
 * (quick win F18, and `docs/design/web-public.md`: a back link on every page
 * that is not a hub). Four pages had none: the phone's own Back was the only
 * way out.
 *
 * The API is stubbed (`public-pages-stub.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import {
  PUBLIC,
  boardBout,
  emptySchedule,
  liveState,
  openGuestSchedule,
  openLiveBoard,
  openPersonPage,
} from './public-pages-stub';

const HOME = '/e/test-event/home';
const backHome = (page: Page) => page.getByRole('link', { name: 'Back to event home' });

const ONE_PISTE = liveState([
  {
    lice: { id: 'lice-1', name: 'Piste 1', sortOrder: 1 },
    runningMatch: boardBout('M01'),
    nextMatch: null,
  },
]);

test('the guest schedule links back to the Event home', async ({ page }) => {
  await openGuestSchedule(page, emptySchedule);
  await expect(backHome(page)).toHaveAttribute('href', HOME);
});

test("a person's page links back to the Event home", async ({ page }) => {
  await openPersonPage(page, emptySchedule);
  await expect(backHome(page)).toHaveAttribute('href', HOME);
});

test('the pass page links back to the Event home', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/test-event/pass`);
  await waitForPageMain(page);
  await expect(backHome(page)).toHaveAttribute('href', HOME);
});

test('the live board links back to the Event home', async ({ page }) => {
  await openLiveBoard(page, ONE_PISTE);
  await expect(backHome(page)).toHaveAttribute('href', HOME);
});

test('one piste of the live board links back to all of them, with a real link', async ({
  page,
}) => {
  await openLiveBoard(page, ONE_PISTE, '?lice=lice-1');
  await expect(page.getByRole('link', { name: 'All lices' })).toHaveAttribute(
    'href',
    '/e/test-event/live',
  );
});

test('a piste the live board does not know links back to the board', async ({ page }) => {
  await openLiveBoard(page, ONE_PISTE, '?lice=gone');
  await expect(page.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
    'href',
    '/e/test-event/live',
  );
});
