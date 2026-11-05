/**
 * The Reported tab and Keep on the photo queue of a staff login with the `photos` job (Event
 * photos, slice 4c; rulings 452, 454-457). The API is stubbed: these are the screen's stories,
 * the server's are its own tests.
 */
import { expect, test, type Page } from '@playwright/test';
import { PAD } from './pad-pistes-stub';

const LAST_REPORT = '2026-11-08T16:30:00.654321+00:00';

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

interface ReportedStub {
  sent: Sent[];
  /** The answer of the next write, when a story wants a refusal. */
  refuse: { status: number; code: string } | null;
}

const photo = (id: string, name: string, reports: Record<string, unknown> = {}) => ({
  id,
  status: 'approved',
  uploaderName: name,
  caption: null,
  tag: { kind: 'tournament', name: 'Longsword Open' },
  createdAt: '2026-11-08T14:05:00.123456+00:00',
  previewUrl: null,
  originalUrl: null,
  reportCount: 0,
  reportComments: [],
  lastReportAt: null,
  ...reports,
});

const REPORTED = photo('p9', 'Tom', {
  reportCount: 3,
  reportComments: ['this is me, please remove', 'blurry'],
  lastReportAt: LAST_REPORT,
});

const SUMMARY = {
  mode: 'live',
  eventSlug: 'spring-open',
  eventName: 'Spring Open',
  storage: 'on',
  lastHour: 2,
  perHourCap: 300,
  bytes: 0,
  bytesCap: 15e9,
  waiting: 0,
  reported: 1,
  deletesAt: null,
  timezone: 'Europe/Paris',
};

async function stubReported(page: Page): Promise<ReportedStub> {
  const state: ReportedStub = { sent: [], refuse: null };
  const me = { type: 'staff', account: { id: 'staff-9', role: 'photos' } };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/staff-auth/me')) return route.fulfill({ json: me });
    if (url.pathname.endsWith('/staff/photos/summary')) return route.fulfill({ json: SUMMARY });
    if (url.pathname.endsWith('/staff/photos') && request.method() === 'GET') {
      const filter = url.searchParams.get('filter');
      const photos =
        filter === 'reported' ? [REPORTED] : filter === 'all' ? [photo('p1', 'Léa'), REPORTED] : [];
      return route.fulfill({ json: { photos, next: null } });
    }
    if (url.pathname.includes('/staff/photos/')) {
      state.sent.push({
        method: request.method(),
        path: url.pathname,
        body: request.postDataJSON() as unknown,
      });
      const refusal = state.refuse;
      if (refusal) {
        return route.fulfill({ status: refusal.status, json: { ...refusal, detail: 'English' } });
      }
      return route.fulfill({ json: { id: 'p9', kept: true } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

/** The queue's photos: the outer list's items, not the comments listed inside a tile. */
const tiles = (page: Page) => page.locator('main ul:not([aria-label]) > li');
const reads = (page: Page, filter: string) =>
  page.waitForRequest(
    (r) => r.method() === 'GET' && r.url().includes(`/staff/photos?filter=${filter}`),
  );

async function openReported(page: Page) {
  await page.goto(`${PAD}/photos`);
  const read = reads(page, 'reported');
  await page.getByRole('tab', { name: 'Reported (1)' }).click();
  await read;
  await expect(tiles(page)).toHaveCount(1);
}

test('lists the reported photos with their count and comments, newest first', async ({ page }) => {
  await stubReported(page);
  await openReported(page);

  const tile = tiles(page).first();
  await expect(tile.getByText('Reports: 3')).toBeVisible();
  const comments = tile.getByRole('list', { name: 'Comments from the reports' });
  await expect(comments.getByRole('listitem')).toHaveText(['this is me, please remove', 'blurry']);
});

test('shows the reports and Keep in All too, and no Keep on a photo with no report', async ({
  page,
}) => {
  await stubReported(page);
  await page.goto(`${PAD}/photos`);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(tiles(page)).toHaveCount(2);

  await expect(tiles(page).nth(0).getByRole('button', { name: 'Keep' })).toHaveCount(0);
  await expect(tiles(page).nth(1).getByRole('button', { name: 'Keep' })).toBeVisible();
});

test('keeps a photo at once with the newest report shown, and reads the queue again', async ({
  page,
}) => {
  const stub = await stubReported(page);
  await openReported(page);

  const reread = reads(page, 'reported');
  await tiles(page).first().getByRole('button', { name: 'Keep' }).click();
  await reread;

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(stub.sent).toEqual([
    { method: 'POST', path: '/api/v1/staff/photos/p9/keep', body: { reportsUpTo: LAST_REPORT } },
  ]);
});

test('says the event is archived when Keep is refused', async ({ page }) => {
  const stub = await stubReported(page);
  stub.refuse = { status: 403, code: 'event_results_frozen' };
  await openReported(page);

  await tiles(page).first().getByRole('button', { name: 'Keep' }).click();

  await expect(page.getByText(/this event is archived/i)).toBeVisible();
  await expect(page.getByText('English')).toHaveCount(0);
});
