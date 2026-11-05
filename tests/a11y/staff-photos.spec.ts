/**
 * The photo queue of a staff login with the `photos` job (Event photos, slice 5b; rulings 435,
 * 437, 438). The API is stubbed: these are the screen's stories, the server's are its own tests.
 */
import { expect, test, type Page } from '@playwright/test';
import { PAD } from './pad-pistes-stub';

interface Sent {
  method: string;
  path: string;
}

interface PhotoStub {
  role: 'photos' | 'checkin';
  sent: Sent[];
  /** The answer of the next write, when a story wants a refusal. */
  refuse: { status: number; code: string } | null;
}

const photo = (id: string, name: string) => ({
  id,
  status: 'waiting',
  uploaderName: name,
  caption: null,
  tag: { kind: 'tournament', name: 'Longsword Open' },
  createdAt: '2026-11-08T14:05:00.123456+00:00',
  previewUrl: null,
  originalUrl: null,
});

const SUMMARY = {
  mode: 'approve',
  eventSlug: 'spring-open',
  eventName: 'Spring Open',
  storage: 'on',
  lastHour: 2,
  perHourCap: 300,
  bytes: 0,
  bytesCap: 15e9,
  waiting: 2,
  deletesAt: null,
  timezone: 'Europe/Paris',
};

async function stubPhotos(page: Page): Promise<PhotoStub> {
  const state: PhotoStub = { role: 'photos', sent: [], refuse: null };
  const me = () => ({ type: 'staff', account: { id: 'staff-9', role: state.role } });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/staff-auth/login')) return route.fulfill({ json: me() });
    if (path.endsWith('/staff-auth/me')) return route.fulfill({ json: me() });
    if (path.endsWith('/staff/photos/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/staff/photos') && request.method() === 'GET') {
      const photos = [photo('p1', 'Léa'), photo('p2', 'Hugo')];
      return route.fulfill({ json: { photos, next: null } });
    }
    if (path.includes('/staff/photos/')) {
      state.sent.push({ method: request.method(), path });
      const refusal = state.refuse;
      if (refusal) {
        return route.fulfill({ status: refusal.status, json: { ...refusal, detail: 'English' } });
      }
      return route.fulfill(
        request.method() === 'DELETE'
          ? { status: 204 }
          : { json: { id: 'p1', status: 'approved' } },
      );
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

const tiles = (page: Page) => page.getByRole('listitem');
const reads = (page: Page) =>
  page.waitForRequest((r) => r.method() === 'GET' && /\/staff\/photos\?filter=/.test(r.url()));

test('the installed app lands a photos login on its queue, not on the pistes', async ({ page }) => {
  await stubPhotos(page);
  await page.goto(`${PAD}/`);
  await page.waitForURL(/\/photos$/);
  await expect(tiles(page)).toHaveCount(2);
});

test('a check-in login reopening the app lands on its desk', async ({ page }) => {
  const stub = await stubPhotos(page);
  stub.role = 'checkin';
  await page.goto(`${PAD}/`);
  await page.waitForURL(/\/desk$/);
});

test('a PIN sign-in with the photos job lands on the queue', async ({ page }) => {
  await stubPhotos(page);
  await page.goto(`${PAD}/login?event=spring-open&u=lea`);
  await page.locator('#staffPin').fill('1234');
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  await page.waitForURL(/\/photos$/);
});

test('Approve sends the photo and reads the queue again', async ({ page }) => {
  const stub = await stubPhotos(page);
  await page.goto(`${PAD}/photos`);
  await expect(tiles(page)).toHaveCount(2);

  const reread = reads(page);
  await tiles(page).first().getByRole('button', { name: 'Approve' }).click();
  await reread;

  expect(stub.sent).toEqual([{ method: 'POST', path: '/api/v1/staff/photos/p1/approve' }]);
});

test('Delete asks first: Cancel sends nothing, Delete sends the delete', async ({ page }) => {
  const stub = await stubPhotos(page);
  await page.goto(`${PAD}/photos`);
  await expect(tiles(page)).toHaveCount(2);

  await tiles(page).first().getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(stub.sent).toEqual([]);

  await tiles(page).first().getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect
    .poll(() => stub.sent)
    .toEqual([{ method: 'DELETE', path: '/api/v1/staff/photos/p1' }]);
});

test('a photo another moderator deleted is said in French, not the server’s English', async ({
  page,
  context,
}) => {
  const stub = await stubPhotos(page);
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PAD }]);
  stub.refuse = { status: 404, code: 'photo_not_found' };
  await page.goto(`${PAD}/photos`);
  await tiles(page).first().getByRole('button', { name: 'Approuver' }).click();

  await expect(page.getByText('Cette photo a déjà été supprimée.')).toBeVisible();
  await expect(page.getByText('English')).toHaveCount(0);
});

// A write's refusal outlives the read that follows the write, and goes when the reader asks for
// a read: it used to stay on screen through every Refresh until the next write.
test('a refused write is said after its own reload, and Refresh clears it', async ({ page }) => {
  const stub = await stubPhotos(page);
  stub.refuse = { status: 404, code: 'photo_not_found' };
  await page.goto(`${PAD}/photos`);
  await tiles(page).first().getByRole('button', { name: 'Approve' }).click();
  const said = page.getByText('This photo was already deleted.');
  await expect(said).toBeVisible();

  const reread = reads(page);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await reread;
  await expect(said).toHaveCount(0);
});

test('an Event archived meanwhile says so, in the screen’s words', async ({ page }) => {
  const stub = await stubPhotos(page);
  stub.refuse = { status: 403, code: 'event_results_frozen' };
  await page.goto(`${PAD}/photos`);
  await tiles(page).first().getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByText(/this event is archived/i)).toBeVisible();
});
