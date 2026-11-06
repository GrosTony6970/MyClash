import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
} from './helpers';
import { PUBLIC } from './public-pages-stub';

/**
 * The page an Event's photo QR code opens (design, "The uploader"; slice 2b). The Event and its
 * Tournament come from `scripts/e2e-server-api-stub.mjs` (`photo-event`, `photo-off-event`); the
 * upload itself is stubbed here, per test.
 */

test.use({ viewport: { width: 390, height: 844 } });

const TOKEN = 'tok-123';
const PAGE = `${PUBLIC}/e/photo-event/photos/send`;

// Only the first bytes matter to the page; the API is stubbed.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic', 'ascii'),
  Buffer.alloc(64),
]);

type Answer = (route: Route) => Promise<void>;
const answer =
  (status: number, json: object): Answer =>
  (route) =>
    route.fulfill({ status, json });

/** Every request the page makes, and the photo POSTs answered in turn by `answers`. */
async function openPage(page: Page, url: string, answers: Answer[] = []) {
  const requested: string[] = [];
  const posts: Request[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await stubPublicApi(page);
  await page.route('**/api/v1/events/ev-photo/photos', async (route) => {
    posts.push(route.request());
    const next = answers.shift();
    if (next) await next(route);
    else await route.abort('connectionrefused');
  });
  await page.goto(url);
  return { requested, posts };
}

const pick = (page: Page, name: string, buffer: Buffer) =>
  page.getByTestId('photo-picker').setInputFiles({ name, mimeType: 'image/jpeg', buffer });
const rows = (page: Page) => page.getByTestId('photo-row');
const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });

/**
 * Before React runs, nothing on the page may act: no `<form>` the browser could submit by itself
 * (Enter in a field would reload the page without its `#token`), and the picker gated on the
 * token, which the server cannot see.
 */
test('the server sends the page with nothing that can send', async ({ page }) => {
  const html = await (await page.request.get(PAGE)).text();
  // The page streams: a loading `<main>` comes first, the page's own later in the same HTML.
  const label = html.indexOf('Take or choose photos');
  expect(label).toBeGreaterThan(-1);
  const main = html.slice(html.lastIndexOf('<main', label), html.indexOf('</main>', label));
  expect(main).not.toContain('<form');
  const buttons = main.match(/<button[^>]*>/g) ?? [];
  expect(buttons).toHaveLength(2);
  for (const button of buttons) expect(button).toMatch(/\sdisabled=""/);
});

test('an Event that takes no photos says so, and offers the Event instead', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openPage(page, `${PUBLIC}/e/photo-off-event/photos/send#${TOKEN}`);

  await expect(page.getByRole('status')).toContainText('This Event does not take photos.');
  await expect(page.getByRole('link', { name: 'See the Event' })).toHaveAttribute(
    'href',
    '/e/photo-off-event/home',
  );
  await expect(page.getByTestId('photo-picker')).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('a link without its token says to scan the code again', async ({ page }) => {
  await openPage(page, PAGE);
  await expect(page.getByRole('status')).toContainText(
    'This link is not complete. Scan the QR code again.',
  );
});

test('a photo goes with its name and Tournament, and waits for approval', async ({ page }) => {
  const issues = collectPageIssues(page);
  const { requested, posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(201, { id: 'p1', status: 'waiting' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Tournament or Workshop').selectOption({ label: 'Longsword Open' });
  await send(page).click();

  await expect(rows(page)).toContainText('Sent. It will show once an organiser approves it.');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.headers()['x-photo-token']).toBe(TOKEN);
  const body = posts[0]!.postDataBuffer()!.toString('latin1');
  expect(body).toMatch(/name="name"\r\n\r\nAda\r\n/);
  expect(body).toMatch(/name="tournamentId"\r\n\r\nev-photo-t1\r\n/);
  expect(body).toContain('filename="a.jpg"');
  expect(requested.filter((url) => url.includes(TOKEN))).toEqual([]);
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

// A new tab, so the photos already picked stay on this one (ruling 475).
test('the notice links to the photo section of the privacy policy, in a new tab', async ({
  page,
}) => {
  await openPage(page, `${PAGE}#${TOKEN}`);
  const link = page.getByRole('link', { name: 'How MyClash handles photos' });
  await expect(link).toHaveAttribute('href', /\/en\/privacypolicy#photos$/);
  await expect(link).toHaveAttribute('target', '_blank');
});

test('a busy answer is sent again on its own', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(503, { code: 'photos_busy', detail: 'Many photos are arriving at once.' }),
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();

  await expect(rows(page)).toContainText('Many photos are arriving at once. Trying again…');
  await expect(rows(page)).toContainText('Sent.', { timeout: 10_000 });
  expect(posts).toHaveLength(2);
});

test('a HEIC photo is refused before a byte is sent', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  // Named .jpg: the bytes decide, not the name.
  await pick(page, 'b.jpg', HEIC);
  await expect(rows(page).getByRole('alert')).toContainText('This photo is in HEIC format.');
  await expect(rows(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();
  await expect(rows(page).nth(1)).toContainText('Sent.');
  // One known call ends the test: a stray POST of the HEIC would be in this list too.
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataBuffer()!.toString('latin1')).toContain('filename="a.jpg"');
});

test('a closed window closes the form, and the next photo is not sent', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(403, { code: 'photos_window_closed', detail: 'Photos are not open for this Event.' }),
  ]);

  await page.getByTestId('photo-picker').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: JPEG },
  ]);
  await send(page).click();

  await expect(page.getByRole('status')).toContainText(
    'Photos are not open for this Event right now.',
  );
  await expect(page.getByRole('link', { name: 'See the Event' })).toBeVisible();
  await expect(send(page)).toHaveCount(0);
  // The second photo is still waiting: not sent, not failed, and no Retry is offered anywhere.
  await expect(rows(page).nth(1).getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(rows(page).nth(1).getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

test('a lost connection keeps the photo, and Retry sends it', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    (route) => route.abort('connectionreset'),
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();
  await expect(rows(page).getByRole('alert')).toHaveText(
    'Could not reach the server. Check your connection and try again.',
  );

  await rows(page).getByRole('button', { name: 'Retry' }).click();
  await expect(rows(page)).toContainText('Sent.');
  expect(posts).toHaveLength(2);
});
