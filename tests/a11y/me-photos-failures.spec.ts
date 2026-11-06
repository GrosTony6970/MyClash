import { expect, test, type Page, type Route } from '@playwright/test';
import { PUBLIC } from './me-stub';
import {
  TAB,
  json,
  minePage,
  myEvent,
  myTiles,
  openTab,
  pick,
  pickButton,
  sendButton,
} from './me-photos-stub';

/**
 * Léa's Photos tab when something goes wrong (slice 6b): "my events" that could not be read
 * (ruling 461), a photo list that could not be read, a login over an hour old, and a send the
 * server refused.
 */

test.use({ viewport: { width: 390, height: 844 } });

const LOAD_FAILED = 'Your events could not be loaded.';
const refused = (status: number, code: string) =>
  json({ statusCode: status, code, message: 'The API said this in English.' }, status);
// Next's route announcer is an `alert` too: read the page's own.
const alertOf = (page: Page) => page.getByRole('main').getByRole('alert');

test.describe('"my events" could not be read', () => {
  const pages = ['/me/events', '/me/events/photo-event', '/me/events/photo-event/schedule'];
  pages.push('/me/events/photo-event/workshops', '/me/events/photo-event/photos');

  for (const path of pages) {
    test(`${path} says so, with Try again`, async ({ page }) => {
      await openTab(page, { events: json({ statusCode: 500 }, 500), url: `${PUBLIC}${path}` });
      await expect(alertOf(page)).toContainText(LOAD_FAILED);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.getByText('Event not found')).toHaveCount(0);
    });
  }

  test('Try again reads them once more and opens the tab', async ({ page }) => {
    let failing = true;
    await openTab(page, {
      events: (route: Route) =>
        failing
          ? route.fulfill({ status: 500, json: { statusCode: 500 } })
          : route.fulfill({ json: [myEvent('approve')] }),
    });
    await expect(alertOf(page)).toContainText(LOAD_FAILED);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Posted as Léa Martin')).toBeVisible();
  });

  test('a body that is not a list is a failed read too', async ({ page }) => {
    await openTab(page, { events: json({}) });
    await expect(alertOf(page)).toContainText(LOAD_FAILED);
  });

  test('a login over an hour old is renewed, and the tab opens', async ({ page }) => {
    await openTab(page, { lapsed: 'events' });
    await expect(page.getByText('Posted as Léa Martin')).toBeVisible();
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
  });
});

test.describe('the Event could not be read on the server', () => {
  test('the page says so with Try again, rather than a form with no tags', async ({ page }) => {
    const broken = myEvent('approve');
    broken.event.slug = 'broken-event';
    await openTab(page, {
      events: json([broken]),
      url: `${PUBLIC}/me/events/broken-event/photos`,
    });
    await expect(page.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible();
    await expect(page.getByText('Posted as Léa Martin')).toHaveCount(0);
  });
});

test.describe('her photo list could not be read', () => {
  test('says so with Try again, and no form until it is read', async ({ page }) => {
    let failing = true;
    await openTab(page, {
      list: (route) =>
        failing
          ? route.fulfill({ status: 500, json: { statusCode: 500 } })
          : route.fulfill({ json: minePage([]) }),
    });
    await expect(page.getByText('Your photos could not be loaded.')).toBeVisible();
    await expect(pickButton(page)).toHaveCount(0);
    // Unread is not "closed": nothing says photos are not open while the list is unread.
    await expect(page.getByText('Photos are not open for this Event right now.')).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Posted as Léa Martin')).toBeVisible();
    await expect(pickButton(page)).toBeEnabled();
  });
});

test.describe('a send', () => {
  test('after a login over an hour old: renewed, then sent once more', async ({ page }) => {
    const { posts } = await openTab(page, {
      lapsed: 'send',
      sends: [json({ id: 'p0', status: 'waiting' }, 201)],
    });
    await pick(page);
    await sendButton(page).click();
    await expect(page.getByTestId('photo-row')).toContainText(
      'Sent. It will show once an organiser approves it.',
    );
    expect(posts).toHaveLength(2);
  });

  test('refused as not her Event: says why and stays on the tab', async ({ page }) => {
    await openTab(page, { sends: [refused(403, 'photo_not_your_event')] });
    await pick(page);
    await sendButton(page).click();
    const why = 'You can send photos here only to your own Events.';
    await expect(page.getByRole('status').filter({ hasText: why })).toBeVisible();
    expect(page.url()).toBe(TAB);
  });

  test('refused for no name: says how to add one, with the way to her profile', async ({
    page,
  }) => {
    await openTab(page, { sends: [refused(403, 'photo_no_name')] });
    await pick(page);
    await sendButton(page).click();
    await expect(page.getByRole('link', { name: 'Go to my profile' })).toHaveAttribute(
      'href',
      '/me/profile',
    );
  });

  test('refused as the upload days closed: says why, the photo row stays', async ({ page }) => {
    await openTab(page, { sends: [refused(403, 'photos_window_closed')] });
    await pick(page);
    await sendButton(page).click();
    const why = 'Photos are not open for this Event right now.';
    await expect(page.getByRole('status').filter({ hasText: why })).toBeVisible();
    await expect(page.getByTestId('photo-row')).toHaveCount(1);
    await expect(myTiles(page)).toHaveCount(0);
  });
});
