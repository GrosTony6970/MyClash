import { expect, test } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';
import {
  json,
  minePage,
  myEvent,
  myPhoto,
  myRange,
  myTiles,
  openTab,
  pick,
  pickButton,
  sendButton,
  tabStrip,
} from './me-photos-stub';

/**
 * Léa's Photos tab, in the hub of one of her Events (design Goal 11, "Where it shows up" item 5;
 * slice 6b): when it shows, the form under her name, her photos with their status, and Delete.
 */

test.describe('the Photos tab', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const sidebarPhotos = (page: import('@playwright/test').Page) =>
    page.locator('aside').getByRole('link', { name: 'Photos', exact: true });

  test('shows in the hub and the sidebar when the Event shows photos', async ({ page }) => {
    await openTab(page, { events: json([myEvent('live')]) });
    await expect(tabStrip(page).getByRole('tab', { name: 'Photos' })).toBeVisible();
    await expect(sidebarPhotos(page)).toBeVisible();
  });

  test('is left out with photos Off and none of hers there', async ({ page }) => {
    await openTab(page, { events: json([myEvent('off', false)]) });
    await expect(tabStrip(page).getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(tabStrip(page).getByRole('tab', { name: 'Photos' })).toHaveCount(0);
    await expect(sidebarPhotos(page)).toHaveCount(0);
  });

  test('stays with photos Off when she has photos there', async ({ page }) => {
    await openTab(page, { events: json([myEvent('off', true)]) });
    await expect(tabStrip(page).getByRole('tab', { name: 'Photos' })).toBeVisible();
    await expect(sidebarPhotos(page)).toBeVisible();
  });
});

test.describe('sending from her personal space', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('posts under her name, with no token, and her photo then shows waiting', async ({
    page,
  }) => {
    const issues = collectPageIssues(page);
    let sent = false;
    const { posts } = await openTab(page, {
      // Her list holds the photo once the server has taken it, never before.
      list: (route) =>
        route.fulfill({ json: minePage(sent ? [myPhoto(0, { status: 'waiting' })] : []) }),
      sends: [
        (route) => {
          sent = true;
          return route.fulfill({ status: 201, json: { id: 'p0', status: 'waiting' } });
        },
      ],
    });
    await expect(page.getByText('Posted as Léa Martin')).toBeVisible();
    await expect(page.getByLabel(/Your name/)).toHaveCount(0);
    await expect(page.getByText('You have not sent photos to this Event from here.')).toBeVisible();
    await expectNoCriticalAxeViolations(page);

    await pick(page);
    await sendButton(page).click();
    await expect(myTiles(page)).toHaveCount(1);
    await expect(myTiles(page).first()).toContainText('Waiting for approval');
    expect(posts).toHaveLength(1);
    expect(new URL(posts[0]!.url()).pathname).toBe('/api/v1/me/events/ev-photo/photos');
    expect(await posts[0]!.headerValue('x-photo-token')).toBeNull();
    await expectNoPageIssues(issues);
  });

  test('the notice links to the photo section of the privacy policy, in a new tab', async ({
    page,
  }) => {
    await openTab(page, { list: json(minePage([])) });
    const link = page.getByRole('link', { name: 'How MyClash handles photos' });
    await expect(link).toHaveAttribute('href', /\/en\/privacypolicy#photos$/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('with no name yet, says how to add one instead of the form', async ({ page }) => {
    await openTab(page, { list: json(minePage([], { posterName: null })) });
    await expect(
      page.getByText('Your photos carry your name: add one to your profile first.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to my profile' })).toHaveAttribute(
      'href',
      '/me/profile',
    );
    await expect(pickButton(page)).toHaveCount(0);
  });

  test('outside the upload days, says so, and her photos and Delete stay', async ({ page }) => {
    await openTab(page, { list: json(minePage([myPhoto(0)], { sendOpen: false })) });
    await expect(page.getByText('Photos are not open for this Event right now.')).toBeVisible();
    await expect(pickButton(page)).toHaveCount(0);
    await expect(sendButton(page)).toHaveCount(0);
    await expect(myTiles(page).getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('with photos Off, says the Event takes no photos', async ({ page }) => {
    await openTab(page, {
      events: json([myEvent('off', true)]),
      list: json(minePage([myPhoto(0)], { sendOpen: false })),
    });
    await expect(page.getByText('This Event does not take photos.')).toBeVisible();
    await expect(pickButton(page)).toHaveCount(0);
  });
});

test.describe('her photos', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Delete asks first; Cancel sends nothing; Delete removes the photo', async ({ page }) => {
    const { deletes } = await openTab(page, { list: json(minePage(myRange(0, 1))) });
    const dialog = page.getByRole('dialog', { name: 'Delete this photo?' });
    const first = myTiles(page).filter({ hasText: 'Photo 0' });

    await first.getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(myTiles(page)).toHaveCount(2);

    await first.getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(myTiles(page)).toHaveCount(1);
    await expect(myTiles(page).first()).toContainText('Photo 1');
    expect(deletes.map((request) => [request.method(), new URL(request.url()).pathname])).toEqual([
      ['DELETE', '/api/v1/me/events/ev-photo/photos/p0'],
    ]);
  });

  test('shows 30, and Load more reads the next from the 30th', async ({ page }) => {
    const { reads } = await openTab(page, {
      list: (route, request) =>
        route.fulfill({
          json: minePage(
            new URL(request.url()).searchParams.has('before') ? myRange(30, 30) : myRange(0, 29),
          ),
        }),
    });
    await expect(myTiles(page)).toHaveCount(30);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(myTiles(page)).toHaveCount(31);
    const more = reads.filter((read) => read.searchParams.has('before'));
    expect(more.map((read) => read.searchParams.get('before'))).toEqual([myPhoto(29).createdAt]);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });
});
